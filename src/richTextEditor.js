import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import './colorPalette.css';

const Parchment = Quill.import('parchment');
const { StyleAttributor, Scope } = Parchment;
const SizeStyle = new StyleAttributor('size', 'font-size', { scope: Scope.INLINE });
const FontStyle = new StyleAttributor('font', 'font-family', { scope: Scope.INLINE });
Quill.register(SizeStyle, true);
Quill.register(FontStyle, true);

const DEFAULT_FONT_SIZE = 38;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 150;
const FONT_SIZE_STEP = 4;
const EDITOR_FOCUS_DELAY = 50;

// ==================== 快捷文字标签 ====================
// 富文本编辑器中的“快捷输入文字”列表：每一项都会渲染成一个可点击的徽章（s-badge），
// 点击后会把对应文字插入到编辑器当前光标处。需要增删快捷文字时直接改这个数组即可，
// 也可以在 createRichTextEditor({ quickTexts: [...] }) 时传入自定义列表覆盖它。
export const DEFAULT_QUICK_TEXTS = [
 '大本',
 '小本',
 '试卷',
 '课本',
 '限时训练',
 'P',
 'T',
 '选择题',
 '大题',
 '背诵',
 '收'
];

// 规范化快捷文字列表：去空白、去重、过滤空项，兼容 "文字" 与 { text, title } 两种写法
function normalizeQuickTexts(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const raw = typeof item === 'string' ? item : item?.text;
    if (raw == null) continue;
    const text = String(raw);
    if (!text.trim() || seen.has(text)) continue;
    seen.add(text);
    result.push({
      text,
      title: typeof item === 'object' && item?.title ? String(item.title) : `在光标处插入「${text}」`,
    });
  }
  return result;
}

function getSelectedFontSize(quill) {
  const range = quill.getSelection();
  if (!range || range.length <= 0) return DEFAULT_FONT_SIZE;
  const formats = quill.getFormat(range);
  const sizeText = typeof formats.size === 'string' ? formats.size : `${DEFAULT_FONT_SIZE}px`;
  const parsed = parseInt(sizeText, 10);
  return Number.isNaN(parsed) ? DEFAULT_FONT_SIZE : parsed;
}

function insertImageToEditor(quill) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const range = quill.getSelection(true);
      const index = range ? range.index : quill.getLength();
      quill.insertEmbed(index, 'image', ev.target?.result || '', 'user');
      quill.setSelection(index + 1, 0, 'silent');
      quill.focus();
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function setEditorHtml(quill, html) {
  const delta = quill.clipboard.convert({ html });
  quill.setContents(delta, 'silent');
}

function getEditorHtml(quill) {
  if (typeof quill.getSemanticHTML === 'function') {
    return quill.getSemanticHTML();
  }
  return quill.root.innerHTML;
}

// 取当前光标/选区：编辑器仍聚焦时用实时选区，否则回退到 Quill 记录的最近一次选区
function getCursorRange(quill) {
  return quill.getSelection() || quill.getSelection(true);
}

// 把一段纯文字插入到编辑器当前光标处（若存在选区则替换选区内容）
export function insertTextAtCursor(quill, text) {
  const value = text == null ? '' : String(text);
  if (!quill || !value) return false;

  const range = getCursorRange(quill);
  const index = range ? range.index : quill.getLength();
  const length = range ? range.length : 0;

  if (length > 0) {
    quill.deleteText(index, length, 'user');
  }
  quill.insertText(index, value, 'user');
  quill.setSelection(index + value.length, 0, 'user');
  quill.focus();
  return true;
}

// ==================== 自由色板 ====================
// sober 自带组件里没有色板/取色器（s-picker 只能挑固定几项），所以这里自己画一个：
//   - 色块网格：一行 12 级灰阶 + 6 行明度 × 12 列色相，任意色相和深浅都能直接点
//   - 自定义：原生取色器、十六进制输入、吸管（浏览器支持 EyeDropper 时）
//   - 最近使用：记住最近选过的颜色，存在 localStorage 里
// 面板是普通 DOM（样式见 colorPalette.css），由 createColorPalette 管理开关与定位。
const RECENT_COLORS_STORAGE_KEY = 'materia_editor_recent_colors';
const MAX_RECENT_COLORS = 8;
const PALETTE_GRAY_STEPS = 12;
const PALETTE_HUES = Array.from({ length: 12 }, (_, i) => i * 30);
const PALETTE_SHADES = [
  { s: 0.62, l: 0.88 },
  { s: 0.78, l: 0.74 },
  { s: 0.85, l: 0.6 },
  { s: 0.88, l: 0.48 },
  { s: 0.82, l: 0.36 },
  { s: 0.7, l: 0.25 },
];

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

// 色板网格的固定配色（构建一次，之后复用）
const PALETTE_COLORS = (() => {
  const colors = [];
  // 顶部一行灰阶：黑到白
  for (let i = 0; i < PALETTE_GRAY_STEPS; i += 1) {
    colors.push(hslToHex(0, 0, 0.98 - i * (0.9 / (PALETTE_GRAY_STEPS - 1))));
  }
  // 彩色区：固定明度的一行行色相
  for (const shade of PALETTE_SHADES) {
    for (const hue of PALETTE_HUES) {
      colors.push(hslToHex(hue, shade.s, shade.l));
    }
  }
  return colors;
})();

/** 把 #rgb / #rrggbb / rgb() / rgba() 统一成大写 #RRGGBB；无法识别返回 null */
function normalizeColorToHex(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const shortHex = /^#([0-9a-f]{3})$/i.exec(text);
  if (shortHex) {
    const [r, g, b] = shortHex[1];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^#([0-9a-f]{6})$/i.test(text)) return text.toUpperCase();
  // Quill 会把内联颜色规范化成 rgb()/rgba()，读取当前颜色时要认得
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(text);
  if (rgb) {
    const toHex = (part) => Math.min(255, Number(part)).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`.toUpperCase();
  }
  return null;
}

/** 色值输入框：允许省略 #（'00aa88'、'0a8' 都认） */
function parseHexInput(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  return normalizeColorToHex(raw.startsWith('#') ? raw : `#${raw}`);
}

function readRecentColors() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_COLORS_STORAGE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const result = [];
    for (const item of raw) {
      const hex = normalizeColorToHex(item);
      if (!hex || seen.has(hex)) continue;
      seen.add(hex);
      result.push(hex);
      if (result.length >= MAX_RECENT_COLORS) break;
    }
    return result;
  } catch {
    return [];
  }
}

function rememberRecentColor(hex) {
  const next = [hex, ...readRecentColors().filter((item) => item !== hex)].slice(0, MAX_RECENT_COLORS);
  try {
    localStorage.setItem(RECENT_COLORS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存不下就算了，不影响本次选色
  }
}

const EYEDROPPER_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.67 3c-.26 0-.51.1-.71.29l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L4 15.29V20h4.71l7.73-7.73 1.42 1.42 1.41-1.41-1.91-1.93 3.12-3.12c.4-.4.4-1.03 0-1.43l-2.09-2.08c-.2-.19-.45-.3-.71-.3zm0 2.83 1.26 1.26-2.69 2.69-1.26-1.26 2.69-2.69zM5.41 16.59l6.45-6.45 1.41 1.41-6.45 6.45H5.41z"/></svg>`;

/**
 * 创建自由色板浮层。
 * @param {object} options
 * @param {HTMLElement} options.container 浮层挂载点（必须是 s-dialog 内部，否则会被对话框盖住）
 * @param {() => string|null} options.getCurrent 取当前文字颜色（每次打开面板时同步）
 * @param {(hex: string) => void} options.onPick 选中颜色
 * @param {() => void} options.onClear 恢复默认颜色
 */
function createColorPalette({ container, getCurrent, onPick, onClear }) {
  const panel = document.createElement('div');
  panel.className = 'color-palette';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '自由色板');
  panel.innerHTML = `
        <div class="cp-head">
            <span class="cp-title">自由色板</span>
            <span class="cp-current" data-empty="true" title="当前文字颜色"></span>
            <button type="button" class="cp-reset">默认</button>
        </div>
        <div class="cp-grid" role="group" aria-label="颜色"></div>
        <div class="cp-custom">
            <label class="cp-native" title="自定义颜色">
                <input type="color" id="cp-native-color" name="text-color" value="#000000" aria-label="自定义颜色">
            </label>
            <input class="cp-hex" id="cp-hex-color" name="text-color-hex" type="text" spellcheck="false" maxlength="7" placeholder="#RRGGBB" aria-label="十六进制颜色">
            <button type="button" class="cp-eyedrop" title="从屏幕取色" aria-label="从屏幕取色" hidden>${EYEDROPPER_ICON}</button>
        </div>
        <div class="cp-recent" hidden>
            <span class="cp-recent-label">最近</span>
            <div class="cp-recent-row"></div>
        </div>`;
  container.appendChild(panel);

  const grid = panel.querySelector('.cp-grid');
  const currentChip = panel.querySelector('.cp-current');
  const resetButton = panel.querySelector('.cp-reset');
  const nativeInput = panel.querySelector('.cp-native input');
  const hexInput = panel.querySelector('.cp-hex');
  const eyedropButton = panel.querySelector('.cp-eyedrop');
  const recentWrap = panel.querySelector('.cp-recent');
  const recentRow = panel.querySelector('.cp-recent-row');

  let isOpen = false;
  let anchorElement = null;

  // 色块按钮；data-color 记颜色，data-current 给当前颜色描边
  const swatchButtons = [];
  const createSwatch = (color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cp-swatch';
    button.dataset.color = color;
    button.style.setProperty('--swatch', color);
    button.title = color;
    button.setAttribute('aria-label', color);
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => pick(color));
    return button;
  };
  for (const color of PALETTE_COLORS) {
    const button = createSwatch(color);
    swatchButtons.push(button);
    grid.appendChild(button);
  }

  function syncCurrent(rawColor) {
    const current = normalizeColorToHex(rawColor);
    if (current) {
      currentChip.style.background = current;
      currentChip.dataset.empty = 'false';
    } else {
      currentChip.style.removeProperty('background');
      currentChip.dataset.empty = 'true';
    }
    for (const button of swatchButtons) {
      button.dataset.current = String(current !== null && button.dataset.color === current);
    }
    // 正在输入时不要抢用户输入的内容
    if (document.activeElement !== hexInput) {
      hexInput.value = current || '';
      hexInput.dataset.invalid = 'false';
    }
    if (current) nativeInput.value = current.toLowerCase();
  }

  function renderRecent() {
    const colors = readRecentColors();
    recentRow.textContent = '';
    recentWrap.hidden = colors.length === 0;
    for (const color of colors) {
      recentRow.appendChild(createSwatch(color));
    }
  }

  function pick(color) {
    const hex = normalizeColorToHex(color);
    if (!hex) return;
    rememberRecentColor(hex);
    onPick(hex);
    syncCurrent(hex);
    renderRecent();
    close();
  }

  function clearColor() {
    onClear();
    syncCurrent(null);
    close();
  }

  function position() {
    if (!isOpen || !anchorElement) return;
    const rect = anchorElement.getBoundingClientRect();
    const gap = 8;
    const width = panel.offsetWidth || 300;
    const height = panel.offsetHeight || 0;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - 8) {
      // 下方放不下就翻到上面，上面也放不下就贴底
      const above = rect.top - gap - height;
      top = above >= 8 ? above : Math.max(8, window.innerHeight - height - 8);
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function onDocumentMouseDown(event) {
    if (panel.contains(event.target)) return;
    if (anchorElement && anchorElement.contains(event.target)) return;
    close();
  }

  function onWindowKeyDown(event) {
    if (event.key !== 'Escape') return;
    // 在 window 捕获阶段拦下 Esc：s-dialog 在 document 捕获阶段监听 Esc 关闭对话框，
    // 不拦住的话按 Esc 会把整个编辑器一起关掉，而这里只想收起色板。
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function open(anchorEl) {
    if (isOpen) return;
    anchorElement = anchorEl;
    anchorEl.setAttribute('aria-expanded', 'true');
    if (panel.parentNode !== container) container.appendChild(panel);
    panel.hidden = false;
    isOpen = true;
    syncCurrent(getCurrent());
    renderRecent();
    position();
    document.addEventListener('mousedown', onDocumentMouseDown, true);
    window.addEventListener('keydown', onWindowKeyDown, true);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    if (anchorElement) anchorElement.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
    window.removeEventListener('keydown', onWindowKeyDown, true);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
  }

  function toggle(anchorEl) {
    if (isOpen) close();
    else open(anchorEl);
  }

  resetButton.addEventListener('click', clearColor);

  // 面板内按下鼠标时保持编辑器选区：否则按钮一被点，Quill 的选区就没了，
  // 颜色只能落在光标处。输入框要能正常聚焦，所以放行。
  panel.addEventListener('mousedown', (event) => {
    if (event.target.closest('input, textarea')) return;
    event.preventDefault();
  });

  nativeInput.addEventListener('input', () => {
    hexInput.value = nativeInput.value.toUpperCase();
    hexInput.dataset.invalid = 'false';
  });
  nativeInput.addEventListener('change', () => pick(nativeInput.value));

  hexInput.addEventListener('input', () => {
    const text = hexInput.value.trim();
    hexInput.dataset.invalid = String(Boolean(text) && !parseHexInput(text));
  });
  hexInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const hex = parseHexInput(hexInput.value);
    if (hex) pick(hex);
    else hexInput.dataset.invalid = 'true';
  });
  hexInput.addEventListener('blur', () => {
    const hex = parseHexInput(hexInput.value);
    if (hex) hexInput.value = hex;
    hexInput.dataset.invalid = 'false';
  });

  if ('EyeDropper' in window) {
    eyedropButton.hidden = false;
    eyedropButton.addEventListener('click', async () => {
      try {
        const result = await new window.EyeDropper().open();
        pick(result.sRGBHex);
      } catch {
        // 用户取消取色，色板保持打开
      }
    });
  }

  return { open, close, toggle };
}

export function createRichTextEditor({
  appState,
  getCurrentEditId,
  setCurrentEditId,
  saveState,
  renderUI,
  quickTexts = DEFAULT_QUICK_TEXTS,
}) {
  let editDialog = null;
  let quill = null;
  let originalHtml = '';
  let draftHtml = '';
  let draftSyncRafId = null;
  let textColorPalette = null;
  // 最近一次有效的选区：点色板按钮 / 取色器时编辑器可能失焦，Quill 的实时选区会变 null，
  // 这时用这里记下的选区继续给文字上色，而不是丢掉用户刚选好的文字。
  let lastRange = null;
  const quickTextItems = normalizeQuickTexts(quickTexts);

  // 渲染快捷文字徽章；点击徽章 -> 在光标处插入文字
  function renderQuickTextBadges() {
    const bar = document.getElementById('quick-text-bar');
    if (!bar) return;
    bar.innerHTML = '';
    bar.hidden = quickTextItems.length === 0;

    quickTextItems.forEach(({ text, title }) => {
      const badge = document.createElement('s-badge');
      badge.className = 'quick-text-badge';
      badge.textContent = text;
      badge.title = title;
      badge.dataset.text = text;
      badge.setAttribute('role', 'button');
      badge.setAttribute('tabindex', '0');
      // 阻止默认行为，避免点击徽章时编辑器失焦、选区丢失
      badge.addEventListener('mousedown', (e) => e.preventDefault());
      badge.onclick = () => {
        if (!quill) return;
        insertTextAtCursor(quill, text);
      };
      badge.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (!quill) return;
        insertTextAtCursor(quill, text);
      });
      bar.appendChild(badge);
    });
  }

  const closeEditorDialog = () => {
    if (!editDialog) return;
    if (textColorPalette) textColorPalette.close();
    setCurrentEditId(null);
    editDialog.showed = false;
    renderUI();
  };

  const handleConfirm = () => {
    if (quill) {
      if (draftSyncRafId !== null) {
        cancelAnimationFrame(draftSyncRafId);
        draftSyncRafId = null;
      }
      draftHtml = getEditorHtml(quill);
    }
    const currentEditId = getCurrentEditId();
    if (currentEditId !== null) {
      const index = appState.findIndex((item) => item.id === currentEditId);
      if (index !== -1) {
        appState[index].content = draftHtml;
        saveState();
      }
    }
    closeEditorDialog();
  };
  const handleCancel = () => {
    if (quill) {
      setEditorHtml(quill, originalHtml || '<p><br></p>');
    }
    closeEditorDialog();
  };

  // 当前生效的选区：优先实时选区，其次最近一次有效选区
  function getEffectiveRange() {
    if (!quill) return null;
    return quill.getSelection() || lastRange;
  }

  // 当前选区 / 光标处的文字颜色（没有设置颜色时返回 null）
  function getCurrentTextColor() {
    const range = getEffectiveRange();
    if (!range) return null;
    const color = quill.getFormat(range).color;
    return typeof color === 'string' ? color : null;
  }

  function applyTextColor(color) {
    if (!quill) return;
    const range = getEffectiveRange();
    const value = color || false;
    if (range && range.length > 0) {
      // 有选中文字：直接给选中的那段上色
      quill.formatText(range.index, range.length, 'color', value, 'user');
    } else {
      // 只有光标：设置接下来输入的文字颜色（和 Quill 自带工具栏的行为一致）
      const index = range ? range.index : quill.getLength();
      quill.setSelection(index, 0, 'silent');
      quill.format('color', value, 'user');
      lastRange = { index, length: 0 };
    }
    quill.focus();
  }

  function bindEditorButtons() {
    const boldBtn = document.getElementById('bold-btn');
    if (boldBtn) {
      boldBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!quill) return;
        const range = quill.getSelection();
        if (!range || range.length <= 0) return;
        const isBold = !!quill.getFormat(range).bold;
        quill.format('bold', !isBold, 'user');
        quill.focus();
      });
    }

    const sizeIncreaseBtn = document.getElementById('size-increase-btn');
    if (sizeIncreaseBtn) {
      sizeIncreaseBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!quill) return;
        const range = quill.getSelection();
        if (!range || range.length <= 0) return;
        const currentSize = getSelectedFontSize(quill);
        const newSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, currentSize + FONT_SIZE_STEP));
        quill.format('size', `${newSize}px`, 'user');
        quill.focus();
      });
    }

    const sizeDecreaseBtn = document.getElementById('size-decrease-btn');
    if (sizeDecreaseBtn) {
      sizeDecreaseBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!quill) return;
        const range = quill.getSelection();
        if (!range || range.length <= 0) return;
        const currentSize = getSelectedFontSize(quill);
        const newSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, currentSize - FONT_SIZE_STEP));
        quill.format('size', `${newSize}px`, 'user');
        quill.focus();
      });
    }

    const addImageBtn = document.getElementById('add-image-btn');
    if (addImageBtn) {
      addImageBtn.onclick = () => {
        if (!quill) return;
        insertImageToEditor(quill);
      };
    }

    const fontPicker = document.getElementById('font-picker');
    if (fontPicker) {
      fontPicker.addEventListener('change', (e) => {
        if (!quill) return;
        const range = quill.getSelection();
        if (!range || range.length <= 0) return;
        const family = e.target?.value || '';
        if (family) {
          quill.format('font', family, 'user');
        } else {
          quill.format('font', false, 'user');
        }
        quill.focus();
      });
    }

    // 字体颜色：打开自由色板（sober 没有色板组件，见文件上方的 createColorPalette）
    const colorBtn = document.getElementById('color-btn');
    if (colorBtn && textColorPalette) {
      // s-icon-button 本身不带按钮语义，补上 role / 键盘操作
      colorBtn.setAttribute('role', 'button');
      colorBtn.setAttribute('aria-label', '字体颜色（自由色板）');
      colorBtn.setAttribute('aria-haspopup', 'dialog');
      colorBtn.setAttribute('aria-expanded', 'false');
      colorBtn.tabIndex = 0;
      // 按下时别让编辑器失焦，保住用户已经选好的文字
      colorBtn.addEventListener('mousedown', (e) => e.preventDefault());
      colorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        textColorPalette.toggle(colorBtn);
      });
      colorBtn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        textColorPalette.toggle(colorBtn);
      });
    }

    const selectAllBtn = document.getElementById('select-all-btn');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!quill) return;
        const length = quill.getLength();
        quill.setSelection(0, length, 'user');
        quill.focus();
      });
    }
  }

  function initRichEditorDialog() {
    editDialog = document.getElementById('text-edit-panel');
    const editorElement = document.getElementById('rich-editor');
    if (!editDialog || !editorElement) return;

    quill = new Quill(editorElement, {
      theme: 'snow',
      modules: {
        toolbar: false,
      },
    });
    quill.root.style.fontSize = `${DEFAULT_FONT_SIZE}px`;
    quill.root.style.lineHeight = '1.2';

    quill.on('text-change', () => {
      if (draftSyncRafId !== null) {
        cancelAnimationFrame(draftSyncRafId);
      }
      draftSyncRafId = requestAnimationFrame(() => {
        draftHtml = getEditorHtml(quill);
        draftSyncRafId = null;
      });
    });

    // 记住最近一次有效选区，色板在编辑器失焦后仍能按它上色
    quill.on('selection-change', (range) => {
      if (range) lastRange = range;
    });

    // 自由色板挂在对话框内部（s-dialog 用原生 dialog 顶层图层，挂 body 上会被盖住）
    textColorPalette = createColorPalette({
      container: editDialog,
      getCurrent: getCurrentTextColor,
      onPick: applyTextColor,
      onClear: () => applyTextColor(null),
    });

    bindEditorButtons();
    renderQuickTextBadges();

    const confirmBtn = document.getElementById('text-edit-confirm');
    const cancelBtn = document.getElementById('text-edit-cancel');
    if (confirmBtn) confirmBtn.onclick = handleConfirm;
    if (cancelBtn) cancelBtn.onclick = handleCancel;

    if (editDialog && !editDialog.__escCloseAttached) {
      editDialog.__escCloseAttached = true;
      document.addEventListener(
        'keydown',
        (e) => {
          if (e.key !== 'Escape' || !editDialog?.showed) return;
          e.preventDefault();
          e.stopPropagation();
          closeEditorDialog();
        },
        true,
      );
    document.addEventListener('keydown', function(event) {
        if (event.ctrlKey && event.key === 'Enter') {
          event.preventDefault(); // 阻止换行
          confirmBtn.click();
        }
  });
    }
  }

  function openEditDialog(id, currentHtml) {
    setCurrentEditId(id);
    if (!quill) return;
    originalHtml = currentHtml || '<p><br></p>';
    draftHtml = originalHtml;
    setEditorHtml(quill, originalHtml);
    if (editDialog) editDialog.showed = true;
    setTimeout(() => {
      quill.focus();
      const length = quill.getLength();
      quill.setSelection(0, length, 'silent');
      lastRange = { index: 0, length };
    }, EDITOR_FOCUS_DELAY);
  }

  return {
    initRichEditorDialog,
    openEditDialog,
  };
}
