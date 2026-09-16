import Quill from 'quill';
import 'quill/dist/quill.snow.css';

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

    const colorPicker = document.getElementById('color-picker');
    if (colorPicker) {
      colorPicker.addEventListener('change', (e) => {
        if (!quill) return;
        const range = quill.getSelection();
        if (!range || range.length <= 0) return;
        const color = e.target?.value || '';
        if (color) {
          quill.format('color', color, 'user');
        } else {
          quill.format('color', false, 'user');
        }
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
    }, EDITOR_FOCUS_DELAY);
  }

  return {
    initRichEditorDialog,
    openEditDialog,
  };
}
