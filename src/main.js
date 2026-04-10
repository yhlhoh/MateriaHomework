// 0个人喜欢用1 2 3 4 5 6 7分模块……
// 但是现在不太有动力（虽然这是必须的）扁平化重构……
// 会改的……吧

// ==================== 1. 导入依赖 ====================
import screenfull from 'screenfull';
import html2canvas from 'html2canvas';
import 'sober';
import { createScheme } from 'sober-theme';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Image as TipTapImage } from '@tiptap/extension-image';   // 使用别名避免冲突

// ==================== 2. IndexedDB存储 ====================
const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('KanbanDB', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('store');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
});

async function setDB(key, val) {
    const db = await dbPromise;
    const tx = db.transaction('store', 'readwrite');
    tx.objectStore('store').put(val, key);
    return new Promise(r => tx.oncomplete = r);
}

async function getDB(key) {
    const db = await dbPromise;
    const tx = db.transaction('store', 'readonly');
    const req = tx.objectStore('store').get(key);
    return new Promise(r => req.onsuccess = () => r(req.result));
}

// ==================== 3. 内联SVG替换器 ====================
const svgCache = new Map();

async function replaceIconMasks(container = document) {
    const masks = container.querySelectorAll('.icon-mask');
    const promises = [];
    for (const span of masks) {
        promises.push((async () => {
            try {
                const iconUrlVar = span.style.getPropertyValue('--icon-url').trim();
                if (!iconUrlVar) return;
                const matches = iconUrlVar.match(/url\(['"]?(.*?)['"]?\)/);
                if (!matches) return;
                const url = matches[1];
                if (!url) return;

                let svgText;
                if (svgCache.has(url)) {
                    svgText = svgCache.get(url);
                } else {
                    const resp = await fetch(url);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    svgText = await resp.text();
                    svgCache.set(url, svgText);
                }

                const parser = new DOMParser();
                const doc = parser.parseFromString(svgText, 'image/svg+xml');
                const svgEl = doc.documentElement;
                if (svgEl.tagName !== 'svg') throw new Error('不是有效的SVG');

                const newSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                for (const attr of svgEl.attributes) {
                    newSvg.setAttribute(attr.name, attr.value);
                }
                while (svgEl.firstChild) {
                    newSvg.appendChild(svgEl.firstChild);
                }

                newSvg.setAttribute('class', span.className + ' icon-svg');
                newSvg.removeAttribute('fill');
                newSvg.setAttribute('fill', 'currentColor');
                if (!newSvg.hasAttribute('viewBox') && newSvg.hasAttribute('width') && newSvg.hasAttribute('height')) {
                    const w = parseFloat(newSvg.getAttribute('width'));
                    const h = parseFloat(newSvg.getAttribute('height'));
                    if (!isNaN(w) && !isNaN(h)) {
                        newSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
                    }
                }

                span.parentNode.replaceChild(newSvg, span);
            } catch (err) {
                console.warn('替换SVG失败:', err, span);
            }
        })());
    }
    await Promise.all(promises);
}

// ==================== 4. 全局状态与看板逻辑 ====================
let appState = [];
const defaultSubjects = [
    { id: 's1', name: '语文', icon: 'assets/chinese.svg', content: ' ', isDeleted: false },
    { id: 's2', name: '数学', icon: 'assets/mathematics.svg', content: ' ', isDeleted: false },
    { id: 's3', name: '英语', icon: 'assets/english.svg', content: ' ', isDeleted: false },
    { id: 's4', name: '物理', icon: 'assets/physics.svg', content: ' ', isDeleted: false },
    { id: 's5', name: '化学', icon: 'assets/chemistry.svg', content: ' ', isDeleted: false },
    { id: 's6', name: '生物', icon: 'assets/biology.svg', content: ' ', isDeleted: false },
    { id: 's7', name: '历史', icon: 'assets/history.svg', content: ' ', isDeleted: false },
    { id: 's8', name: '政治', icon: 'assets/politics.svg', content: ' ', isDeleted: false },
    { id: 's9', name: '地理', icon: 'assets/geography.svg', content: ' ', isDeleted: false }
];

function initData() {
    const saved = localStorage.getItem('kanban_data');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            appState = defaultSubjects.map(def => {
                const found = parsed.find(p => p.id === def.id);
                if (found) {
                    return { ...def, content: found.content || '', isDeleted: found.isDeleted || false };
                }
                return { ...def, content: '', isDeleted: false };
            });
        } catch (e) {
            appState = JSON.parse(JSON.stringify(defaultSubjects));
        }
    } else {
        appState = JSON.parse(JSON.stringify(defaultSubjects));
    }
    return renderUI();
}

async function renderUI() {
    const taskList = document.getElementById('task-list');
    const restorePanel = document.getElementById('restore-panel');

    taskList.innerHTML = '';
    restorePanel.innerHTML = '';

    appState.forEach((subject) => {
        if (!subject.isDeleted) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'task-item';
            itemDiv.innerHTML = `
                <div class="subject-tag">
                    <span class="icon-mask" style="--icon-url: url('${subject.icon}')" aria-hidden="true"></span>
                    <span>${subject.name}</span>
                </div>
                <div class="task-content" data-id="${subject.id}">${subject.content}</div>
                <s-ripple attached="true"></s-ripple>
                <button class="delete-btn" title="隐藏科目">×</button>
            `;

            const contentDiv = itemDiv.querySelector('.task-content');
            contentDiv.removeAttribute('contenteditable');
            const taskId = subject.id;
            contentDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditDialog(taskId, contentDiv.innerHTML);
            });

            const delBtn = itemDiv.querySelector('.delete-btn');
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSubject(taskId, itemDiv);
            });

            taskList.appendChild(itemDiv);
        } else {
            const btn = document.createElement('div');
            btn.className = 'restore-btn primary-btn';
            btn.setAttribute('data-name', '恢复 ' + subject.name);
            btn.innerHTML = `<span class="icon-mask" style="--icon-url: url('${subject.icon}')" aria-hidden="true"></span><s-ripple attached="true"></s-ripple>`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                restoreSubject(subject.id);
            });
            restorePanel.appendChild(btn);
        }
    });

    await replaceIconMasks(taskList);
    await replaceIconMasks(restorePanel);
}

function resetPic() {
    indexedDB.deleteDatabase('KanbanDB');
}

window.resetPic = resetPic;

function resetContent() {
  localStorage.removeItem('kanban_data');
}

window.resetContent = resetContent;

function deleteSubject(id, taskItem) {
    const index = appState.findIndex(s => s.id === id);
    if (index === -1) return;
    taskItem.style.opacity = '0';
    taskItem.style.transform = 'scale(0.9)';
    setTimeout(() => {
        appState[index].isDeleted = true;
        saveState();
        renderUI();
    }, 220);
}

function restoreSubject(id) {
    const index = appState.findIndex(s => s.id === id);
    if (index === -1) return;
    appState[index].isDeleted = false;
    saveState();
    renderUI();
}

function saveState() {
    localStorage.setItem('kanban_data', JSON.stringify(appState));
}

// 根据 ID 更新任务内容
function updateTaskContentById(taskId, newHtml) {
    const taskContent = document.querySelector(`.task-content[data-id="${taskId}"]`);
    if (taskContent) {
        taskContent.innerHTML = newHtml;
    }
    const subject = appState.find(s => s.id === taskId);
    if (subject) {
        subject.content = newHtml;
        saveState();
        if (window.recomputeScale) window.recomputeScale();
    }
}

// ==================== 5. 富文本编辑器 ====================

// 自定义文本样式扩展
const CustomTextStyle = TextStyle.extend({
  name: 'textStyle',
  addAttributes() {
    return {
      fontSize: {
        default: null,
        parseHTML: element => element.style.fontSize,
        renderHTML: attributes => {
          if (!attributes.fontSize) return {};
          return { style: `font-size: ${attributes.fontSize}` };
        },
      },
      fontFamily: {
        default: null,
        parseHTML: element => element.style.fontFamily,
        renderHTML: attributes => {
          if (!attributes.fontFamily) return {};
          return { style: `font-family: ${attributes.fontFamily}` };
        },
      },
      color: {
        default: null,
        parseHTML: element => element.style.color,
        renderHTML: attributes => {
          if (!attributes.color) return {};
          return { style: `color: ${attributes.color}` };
        },
      },
    };
  },
  addCommands() {
    return {
      setFontSize: size => ({ chain }) => {
        return chain()
          .setMark('textStyle', { fontSize: size })
          .run();
      },
      unsetFontSize: () => ({ chain }) => {
        return chain()
          .setMark('textStyle', { fontSize: null })
          .removeEmptyTextStyle()
          .run();
      },
      setFontFamily: family => ({ chain }) => {
        return chain()
          .setMark('textStyle', { fontFamily: family })
          .run();
      },
      unsetFontFamily: () => ({ chain }) => {
        return chain()
          .setMark('textStyle', { fontFamily: null })
          .removeEmptyTextStyle()
          .run();
      },
      setColor: color => ({ chain }) => {
        return chain()
          .setMark('textStyle', { color })
          .run();
      },
      unsetColor: () => ({ chain }) => {
        return chain()
          .setMark('textStyle', { color: null })
          .removeEmptyTextStyle()
          .run();
      },
    };
  },
});

// 辅助函数：从原生 Selection 获取 TipTap 文档位置
function getCurrentTipTapSelection() {
  if (!currentEditor) return null;
  const { view } = currentEditor;
  const nativeSel = window.getSelection();
  if (!nativeSel || nativeSel.rangeCount === 0) return null;
  const range = nativeSel.getRangeAt(0);
  if (!view.dom.contains(range.commonAncestorContainer)) return null;
  const from = view.posAtDOM(range.startContainer, range.startOffset);
  const to = view.posAtDOM(range.endContainer, range.endOffset);
  if (from === undefined || to === undefined) return null;
  return { from, to };
}

function getSelectedFontSize() {
  const sel = getCurrentTipTapSelection();
  if (!sel || sel.from === sel.to) return null;
  const { state, view } = currentEditor;
  
  // 1. 优先从 marks 获取
  let fontSize = null;
  state.doc.nodesBetween(sel.from, sel.to, (node) => {
    if (node.marks) {
      node.marks.forEach(mark => {
        if (mark.type.name === 'textStyle' && mark.attrs.fontSize) {
          fontSize = mark.attrs.fontSize;
        }
      });
    }
  });
  if (fontSize) {
    const match = fontSize.match(/\d+/);
    if (match) return parseInt(match[0]);
  }
  
  // 2. 从 DOM 计算样式（安全包裹）
  try {
    const fromNode = view.domAtPos(sel.from);
    const toNode = view.domAtPos(sel.to);
    const range = document.createRange();
    range.setStart(fromNode.node, fromNode.offset);
    range.setEnd(toNode.node, toNode.offset);
    const clonedContents = range.cloneContents();
    
    // 创建一个块级容器，确保有元素节点
    const container = document.createElement('div');
    container.appendChild(clonedContents);
    
    // 如果容器内没有任何子元素（比如只有文本），则文本节点直接作为容器的 innerText
    // 但我们需要一个元素来计算样式，所以主动包裹一个 span
    let elementForStyle = container.firstElementChild;
    if (!elementForStyle) {
      // 只有文本节点或空，创建一个 span 包裹所有内容
      const span = document.createElement('span');
      while (container.firstChild) {
        span.appendChild(container.firstChild);
      }
      container.appendChild(span);
      elementForStyle = span;
    }
    
    const computed = window.getComputedStyle(elementForStyle);
    const domSize = computed.fontSize;
    if (domSize) {
      const match = domSize.match(/\d+/);
      if (match) return parseInt(match[0]);
    }
  } catch (e) {
    console.warn('getSelectedFontSize DOM fallback failed', e);
  }
  
  return 38; // 默认字号
}

// 编辑器实例
let editDialog = null;
let currentEditor = null;
let currentEditId = null;  
let imeStartedInEmptyBlock = false;
const IME_DEBUG = true;
const imeDebugLogs = [];
let imeGlobalDebugAttached = false;

function pushImeDebugLog(entry) {
  if (!IME_DEBUG) return;
  imeDebugLogs.push(entry);
  if (imeDebugLogs.length > 500) {
    imeDebugLogs.shift();
  }
}

window.__getImeDebugLogs = () => imeDebugLogs.slice();
window.__clearImeDebugLogs = () => {
  imeDebugLogs.length = 0;
};

function getImeDebugSnapshot(view) {
  const { state } = view;
  const { from, to, empty, $from } = state.selection;
  const blockStart = from - $from.parentOffset;
  const textBeforeCursor = state.doc.textBetween(blockStart, from, '\n', '\0');
  return {
    from,
    to,
    empty,
    parentOffset: $from.parentOffset,
    parentText: $from.parent.textContent,
    textBeforeCursor,
  };
}

function logIme(view, phase, extra = {}) {
  if (!IME_DEBUG) return;
  try {
    const payload = {
      ts: Date.now(),
      phase,
      ...getImeDebugSnapshot(view),
      ...extra,
    };
    pushImeDebugLog(payload);
    console.log('[IME-DEBUG]', payload);
  } catch (err) {
    const payload = { ts: Date.now(), phase, error: String(err), ...extra };
    pushImeDebugLog(payload);
    console.log('[IME-DEBUG]', payload);
  }
}

function attachImeDebugListeners(view) {
  if (!IME_DEBUG) return;
  const dom = view.dom;
  if (!dom || dom.__imeDebugAttached) return;
  dom.__imeDebugAttached = true;

  const events = [
    'compositionstart',
    'compositionupdate',
    'compositionend',
    'beforeinput',
    'input',
    'keydown',
    'keyup',
  ];

  events.forEach((type) => {
    dom.addEventListener(type, (e) => {
      logIme(view, `dom:${type}`, {
        data: typeof e.data === 'string' ? e.data : null,
        inputType: e.inputType || null,
        isComposing: !!e.isComposing,
        key: e.key || null,
        code: e.code || null,
      });
    }, true);
  });
}

function attachGlobalImeDebugListeners() {
  if (!IME_DEBUG || imeGlobalDebugAttached) return;
  imeGlobalDebugAttached = true;

  const events = [
    'compositionstart',
    'compositionupdate',
    'compositionend',
    'beforeinput',
    'input',
    'keydown',
    'keyup',
  ];

  events.forEach((type) => {
    document.addEventListener(type, (e) => {
      const editorView = currentEditor?.view;
      const target = e.target;
      const inEditor = !!editorView && !!target && editorView.dom.contains(target);
      const snapshot = editorView ? getImeDebugSnapshot(editorView) : null;
      const payload = {
        ts: Date.now(),
        phase: `doc:${type}`,
        data: typeof e.data === 'string' ? e.data : null,
        inputType: e.inputType || null,
        isComposing: !!e.isComposing,
        key: e.key || null,
        code: e.code || null,
        activeTag: document.activeElement ? document.activeElement.tagName : null,
        targetTag: target && target.tagName ? target.tagName : null,
        inEditor,
        snapshot,
      };
      pushImeDebugLog(payload);
      console.log('[IME-DEBUG]', payload);
    }, true);
  });
}

// 粘贴时保留颜色等样式
function handlePaste(event) {
  event.preventDefault();
  const html = event.clipboardData.getData('text/html');
  const text = event.clipboardData.getData('text/plain');
  if (html) {
    // 解析 HTML，保留内联样式
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    // 遍历所有元素，提取 color、background-color、font-size 等
    const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while (node = walker.nextNode()) {
      const style = node.style;
      const color = style.color;
      const bgColor = style.backgroundColor;
      const fontSize = style.fontSize;
      let inlineStyle = '';
      if (color) inlineStyle += `color: ${color};`;
      if (bgColor) inlineStyle += `background-color: ${bgColor};`;
      if (fontSize) inlineStyle += `font-size: ${fontSize};`;
      if (inlineStyle) node.setAttribute('style', inlineStyle);
    }
    const cleanedHtml = doc.body.innerHTML;
    currentEditor.commands.insertContent(cleanedHtml);
  } else if (text) {
    currentEditor.commands.insertContent(text);
  }
}

function initRichEditorDialog() {
  editDialog = document.getElementById('text-edit-panel');
  const editorElement = document.getElementById('rich-editor');

  if (!editDialog || !editorElement) return;

  attachGlobalImeDebugListeners();

  editorElement.style.lineHeight = '1.2';

  // 添加样式消除段落边距
  const style = document.createElement('style');
  style.textContent = '#rich-editor p { margin: 0; }';
  document.head.appendChild(style);

  currentEditor = new Editor({
    element: editorElement,
    editorProps: {
        handleDOMEvents: {
        compositionstart(view) {
          attachImeDebugListeners(view);
          const { state } = view;
          const { $from } = state.selection;
          imeStartedInEmptyBlock = $from.parentOffset === 0 && $from.parent.textContent.length === 0;
          logIme(view, 'handler:compositionstart', {
            imeStartedInEmptyBlock,
          });
          return false;
        },
        compositionend(view, event) {
          // Chrome + 微软拼音在空段落首位输入时可能留下拼音前缀（如 ce测试）。
          // 以“当前段落首部 -> 光标位置”的真实文本为准进行修正。
          logIme(view, 'handler:compositionend', {
            eventData: typeof event?.data === 'string' ? event.data : null,
            imeStartedInEmptyBlock,
          });

          setTimeout(() => {
            if (!imeStartedInEmptyBlock) return;

            const { state } = view;
            const { from, empty, $from } = state.selection;
            if (!empty) return;

            const blockStart = from - $from.parentOffset;
            if (blockStart >= from) return;

            const textBeforeCursor = state.doc.textBetween(blockStart, from, '\n', '\0');
            const match = textBeforeCursor.match(/^([A-Za-z]{1,20})([\u3400-\u9FFF].*)$/);
            if (!match) {
              logIme(view, 'cleanup:skip-no-match');
              return;
            }

            const fixedText = match[2];
            logIme(view, 'cleanup:apply', {
              original: textBeforeCursor,
              fixedText,
            });
            view.dispatch(state.tr.insertText(fixedText, blockStart, from));
          }, 0);

          imeStartedInEmptyBlock = false;

          return false;
        },
        }
    },
    extensions: [
      StarterKit.configure({
        textStyle: false,
        dropcursor: false,
      }),
      CustomTextStyle,
      TipTapImage.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (!currentEditId) return;
      const index = appState.findIndex(item => item.id === currentEditId);
      if (index === -1) return;
      appState[index].content = editor.getHTML();
      saveState();
    }
  });

  if (IME_DEBUG && currentEditor?.view) {
    attachImeDebugListeners(currentEditor.view);
    logIme(currentEditor.view, 'init:editor-ready');
  }

  // 自定义粘贴处理（保留颜色样式）
  editorElement.addEventListener('paste', handlePaste);

  bindRichEditorButtons();

  const confirmBtn = document.getElementById('text-edit-confirm');
  const cancelBtn = document.getElementById('text-edit-cancel');

  if (confirmBtn) confirmBtn.onclick = () => {
    editDialog.showed = false;
    // 关闭时刷新任务列表显示
    renderUI();
  };
  if (cancelBtn) cancelBtn.onclick = () => {
    // 取消时恢复原有内容
    if (currentEditId !== null) {
      const originalHtml = appState[currentEditId].content;
      currentEditor.commands.setContent(originalHtml);
    }
    editDialog.showed = false;
    renderUI();
  };
}

function bindRichEditorButtons() {
  // 加粗
  const boldBtn = document.getElementById('bold-btn');
  if (boldBtn) {
    boldBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (!currentEditor) return;
      const selection = getCurrentTipTapSelection();
      if (!selection || selection.from === selection.to) return;
      const { from, to } = selection;
      currentEditor.chain().focus().toggleBold().run();
      currentEditor.commands.setTextSelection({ from, to });
    });
  }

  // 增大字号（基于选中文本的实际字号）
  const sizeIncreaseBtn = document.getElementById('size-increase-btn');
  if (sizeIncreaseBtn) {
    sizeIncreaseBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (!currentEditor) return;
      const selection = getCurrentTipTapSelection();
      if (!selection || selection.from === selection.to) return;
      const { from, to } = selection;
      let currentSize = getSelectedFontSize();
      if (!currentSize) currentSize = 16;
      let newSize = Math.min(150, Math.max(8, currentSize + 4));
      currentEditor.chain().focus().setFontSize(`${newSize}px`).run();
      currentEditor.commands.setTextSelection({ from, to });
    });
  }

  // 减小字号
  const sizeDecreaseBtn = document.getElementById('size-decrease-btn');
  if (sizeDecreaseBtn) {
    sizeDecreaseBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (!currentEditor) return;
      const selection = getCurrentTipTapSelection();
      if (!selection || selection.from === selection.to) return;
      const { from, to } = selection;
      let currentSize = getSelectedFontSize();
      if (!currentSize) currentSize = 16;
      let newSize = Math.min(150, Math.max(8, currentSize - 4));
      currentEditor.chain().focus().setFontSize(`${newSize}px`).run();
      currentEditor.commands.setTextSelection({ from, to });
    });
  }

  // 插入图片
  const addImageBtn = document.getElementById('add-image-btn');
  if (addImageBtn) {
    addImageBtn.onclick = () => insertImageToEditor();
  }

  // 字体选择（支持部分文本单独设置）
  const fontPicker = document.getElementById('font-picker');
  if (fontPicker) {
    fontPicker.addEventListener('mousedown', (e) => {
      // 阻止焦点转移，保存当前选区
      e.preventDefault();
      if (!currentEditor) return;
      const savedSelection = getCurrentTipTapSelection();
      if (!savedSelection || savedSelection.from === savedSelection.to) return;
      // 临时存储，待 change 时使用
      fontPicker._savedSelection = savedSelection;
    });
    fontPicker.addEventListener('change', (e) => {
      if (!currentEditor) return;
      let { from, to } = currentEditor.state.selection;
      if (from === to && fontPicker._savedSelection) {
        from = fontPicker._savedSelection.from;
        to = fontPicker._savedSelection.to;
      }
      if (from === to) return;
      const family = e.target.value;
      if (family) {
        currentEditor.chain().focus().setFontFamily(family).run();
      } else {
        currentEditor.chain().focus().unsetFontFamily().run();
      }
      currentEditor.commands.setTextSelection({ from, to });
      delete fontPicker._savedSelection;
    });
  }
}

function insertImageToEditor() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (file && currentEditor) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        // 保存当前选区，插入图片后恢复光标位置
        const selection = getCurrentTipTapSelection();
        currentEditor.chain().focus().setImage({ src: ev.target.result }).run();
        if (selection && selection.from !== selection.to) {
          currentEditor.commands.setTextSelection(selection);
        }
      };
      reader.readAsDataURL(file);
    }
  };
  input.click();
}

function openEditDialog(id, currentHtml) {
  currentEditId = id;
  if (!currentEditor) return;
  currentEditor.commands.setContent(currentHtml || '');
  if (editDialog) editDialog.showed = true;
  setTimeout(() => {
    currentEditor.commands.focus();
    currentEditor.commands.selectAll();
  }, 50);
}

// ==================== 6. 主题应用 + 主色缓存 ====================
const PRIMARY_COLOR_CACHE_KEY = 'cached_primary_color';

function getCachedPrimaryColor() {
  return localStorage.getItem(PRIMARY_COLOR_CACHE_KEY);
}

function setCachedPrimaryColor(hex) {
    if (hex && hex.startsWith('#')) {
    localStorage.setItem(PRIMARY_COLOR_CACHE_KEY, hex);
    }
}

function getPrimaryColorFromPage() {
    const page = document.querySelector('s-page');
    if (!page) return null;
    const color = getComputedStyle(page).getPropertyValue('--s-color-primary').trim();
    return color || null;
}

function ensureSPage() {
    let sPage = document.querySelector('s-page');
    if (!sPage) {
        sPage = document.createElement('s-page');
        document.body.insertBefore(sPage, document.body.firstChild);
    }
    return sPage;
}

async function applyMaterialYouTheme(source) {
    const pageElement = ensureSPage();
    try {
        if (typeof source === 'string' && source.startsWith('#')) {
            await createScheme(source, { page: pageElement });
        } else if (source instanceof HTMLImageElement) {
            await createScheme(source, { page: pageElement });
        } else if (source instanceof File) {
            const img = new window.Image();
            const url = URL.createObjectURL(source);
            img.src = url;
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });
            await createScheme(img, { page: pageElement });
            URL.revokeObjectURL(url);
        } else {
            throw new Error('不支持的 source 类型');
        }
        // 主题生成后，获取实际主色并缓存
        const primaryColor = getPrimaryColorFromPage();
        if (primaryColor) {
            setCachedPrimaryColor(primaryColor);
        }
    } catch (error) {
        console.error('主题生成失败，使用默认颜色', error);
        await createScheme('#9C4F4F', { page: pageElement });
        const defaultColor = getPrimaryColorFromPage();
        if (defaultColor) setCachedPrimaryColor(defaultColor);
    }
}

// ==================== 7. 图片操作 ====================
let savedCustomImages = [];
let currentBgObjectUrl = null;

function applyBackgroundImage(url, revokePrevious = false) {
    if (revokePrevious && currentBgObjectUrl) {
        URL.revokeObjectURL(currentBgObjectUrl);
    }
    if (url.startsWith('blob:')) {
        currentBgObjectUrl = url;
    }
    document.body.style.backgroundImage = `url('${url}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center center';
    document.body.style.backgroundRepeat = 'no-repeat';
}

async function loadImages() {
    // 1. 加载背景图片文件（如果有）
    const bgFile = await getDB('background_img');
    
    // 2. 处理主题生成（优先使用缓存主色）
    const cachedColor = getCachedPrimaryColor();
    if (cachedColor) {
        // 有缓存主色，直接使用（避免重复取色）
        await applyMaterialYouTheme(cachedColor);
    } else if (bgFile) {
        // 无缓存但有背景图片，从图片取色并自动缓存
        await applyMaterialYouTheme(bgFile);
    } else {
        // 无缓存无图片，使用默认颜色并缓存
        await applyMaterialYouTheme('#9C4F4F');
    }
    
    // 3. 应用背景图片（必须在主题之后，避免覆盖样式）
    if (bgFile) {
        const url = URL.createObjectURL(bgFile);
        applyBackgroundImage(url);
    }
    
    // 4. 加载自定义图片库
    savedCustomImages = (await getDB('custom_images')) || [];
    savedCustomImages.forEach(imgData => createCustomImgElement(imgData.id, imgData.file));
}

document.getElementById('bg-change-btn').addEventListener('click', () => {
    const input = document.getElementById('bg-input');
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            applyBackgroundImage(url, true);
            await setDB('background_img', file);
            // 重新从图片提取主色并自动缓存
            await applyMaterialYouTheme(file);
        }
        input.value = '';
    };
    input.click();
});

document.getElementById('img-add-btn').addEventListener('click', () => {
    const input = document.getElementById('img-input');
    input.onchange = async (e) => {
        const files = e.target.files;
        for (let i = 0; i < files.length; i++) {
            const id = Date.now().toString() + Math.random();
            savedCustomImages.push({ id, file: files[i] });
            createCustomImgElement(id, files[i]);
        }
        await setDB('custom_images', savedCustomImages);
        input.value = '';
    };
    input.click();
});

function createCustomImgElement(id, file) {
    const url = URL.createObjectURL(file);
    const container = document.createElement('div');
    const ripple = document.createElement('s-ripple');
    ripple.attached = 'true';
    const img = document.createElement('img');
    img.src = url;
    img.title = "点击删除此图片";
    img.onclick = async function() {
        this.classList.add('fade-out');
        setTimeout(this.remove.bind(this), 300);
        URL.revokeObjectURL(url);
        savedCustomImages = savedCustomImages.filter(item => item.id !== id);
        await setDB('custom_images', savedCustomImages);
    };
    document.getElementById('custom-images-container').appendChild(container);
    container.appendChild(img);
    container.appendChild(ripple);
}

// ==================== 8. 时钟 ====================
function updateClock() {
    const now = new Date();
    document.getElementById('hours').textContent = String(now.getHours()).padStart(2, '0');
    document.getElementById('minutes').textContent = String(now.getMinutes()).padStart(2, '0');
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    document.getElementById('date').textContent = `${days[now.getDay()]}, ${now.getMonth() + 1}月${now.getDate()}日`;
}

// ==================== 9. 截图导出 ====================
function disableTransitionsTemp() {
    const style = document.createElement('style');
    style.id = 'temp-disable-transitions';
    style.innerHTML = `* { transition: none !important; animation: none !important; }`;
    document.head.appendChild(style);
    return () => {
        const el = document.getElementById('temp-disable-transitions');
        if (el) el.remove();
    };
}

document.getElementById('save-btn').addEventListener('click', async () => {
    try {
        const controls = document.querySelector('.controls');
        const restorePanel = document.getElementById('restore-panel');
        if (controls) controls.style.display = 'none';
        if (restorePanel) restorePanel.style.display = 'none';
        const restoreTransitions = disableTransitionsTemp();
        await new Promise(resolve => setTimeout(resolve, 300));
        const canvas = await html2canvas(document.body, {
            scale: 2,
            useCORS: true,
            backgroundColor: null
        });
        restoreTransitions();
        if (controls) controls.style.display = '';
        if (restorePanel) restorePanel.style.display = '';
        const imgData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'MateriaHomework.png';
        link.href = imgData;
        link.click();
    } catch (err) {
        console.error('截图失败:', err);
    }
});

// ==================== 10. 自适应缩放 ====================
let scaleRafId = 0;
let scalePanel = null;

function setScale(v) {
    document.documentElement.style.setProperty("--task-scale", String(v));
}

function clearInlineFontSize() {
    if (scalePanel) {
        scalePanel.querySelectorAll(".task-content").forEach(el => {
            el.style.fontSize = "";
        });
    }
}

function fits() {
    return scalePanel ? scalePanel.scrollHeight <= scalePanel.clientHeight + 0.5 : true;
}

function recomputeScale() {
    if (!scalePanel) return;
    clearInlineFontSize();
    setScale(1);
    scalePanel.getBoundingClientRect();
    if (fits()) return;
    let lo = 0.55;
    let hi = 1;
    const EPS = 0.002;
    while (hi - lo > EPS) {
        const mid = (lo + hi) / 2;
        setScale(mid);
        scalePanel.getBoundingClientRect();
        if (fits()) lo = mid;
        else hi = mid;
    }
    setScale(lo);
}

function scheduleScale() {
    cancelAnimationFrame(scaleRafId);
    scaleRafId = requestAnimationFrame(recomputeScale);
}

window.recomputeScale = recomputeScale;

// ==================== 11. Service Worker ====================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('Service Worker 注册成功:', registration.scope))
            .catch(error => console.log('Service Worker 注册失败:', error));
    });
}

// ==================== 12. 初始化 ====================
setInterval(updateClock, 1000);
updateClock();

window.resetContent = function() {
  localStorage.removeItem('kanban_data');
    location.reload();
};

window.resetPic = function() {
    indexedDB.deleteDatabase('KanbanDB');
    localStorage.removeItem(PRIMARY_COLOR_CACHE_KEY);  // 同时清除主色缓存
    location.reload();
};

(async () => {
    initRichEditorDialog();
    await initData();
    await loadImages();
    await replaceIconMasks(document.querySelector('.controls'));
    
    scalePanel = document.querySelector(".right-panel");
    if (scalePanel) {
        scalePanel.addEventListener("input", scheduleScale, true);
        const mo = new MutationObserver(scheduleScale);
        mo.observe(scalePanel, { childList: true, subtree: true, characterData: true });
        const ro = new ResizeObserver(scheduleScale);
        ro.observe(scalePanel);
        ro.observe(document.body);
        window.addEventListener("resize", scheduleScale);
        requestAnimationFrame(() => requestAnimationFrame(recomputeScale));
    }
    
    const modal = document.querySelector('.loading-modal');
    modal.classList.add('fade-out');
    modal.addEventListener('transitionend', () => modal.remove());
})();

document.getElementById('full-screen-btn').addEventListener('click', () => {
    if (screenfull.isEnabled) screenfull.toggle();
});