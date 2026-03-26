// ==================== 1. 导入依赖 ====================
import {
    argbFromHex,
    hexFromArgb,
    argbFromRgb,
    QuantizerCelebi,
    Score,
    CorePalette,
    Hct
} from '@material/material-color-utilities';
import screenfull from 'screenfull';
import html2canvas from 'html2canvas';
import { Dialog, Ripple } from 'sober';
import { createScheme } from 'sober-theme';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';   // 命名导入
import { Image } from '@tiptap/extension-image';    

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
    { id: 's1', name: '语文', icon: 'assets/chinese.svg', content: '', isDeleted: false },
    { id: 's2', name: '数学', icon: 'assets/mathematics.svg', content: '', isDeleted: false },
    { id: 's3', name: '英语', icon: 'assets/english.svg', content: '', isDeleted: false },
    { id: 's4', name: '物理', icon: 'assets/physics.svg', content: '', isDeleted: false },
    { id: 's5', name: '化学', icon: 'assets/chemistry.svg', content: '', isDeleted: false },
    { id: 's6', name: '生物', icon: 'assets/biology.svg', content: '', isDeleted: false },
    { id: 's7', name: '历史', icon: 'assets/history.svg', content: '', isDeleted: false },
    { id: 's8', name: '政治', icon: 'assets/politics.svg', content: '', isDeleted: false },
    { id: 's9', name: '地理', icon: 'assets/geography.svg', content: '', isDeleted: false }
];

function initData() {
    const saved = localStorage.getItem('kanban_data');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            appState = defaultSubjects.map(def => {
                const found = parsed.find(p => p.name === def.name);
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

    appState.forEach((subject, index) => {
        if (!subject.isDeleted) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'task-item';
            itemDiv.innerHTML = `
                <div class="subject-tag">
                    <span class="icon-mask" style="--icon-url: url('${subject.icon}')" aria-hidden="true"></span>
                    <span>${subject.name}</span>
                </div>
                <div class="task-content" data-index="${index}">${subject.content}</div>
                <s-ripple attached="true"></s-ripple>
                <button class="delete-btn" title="隐藏科目">×</button>
            `;

            const contentDiv = itemDiv.querySelector('.task-content');
            contentDiv.removeAttribute('contenteditable');
            contentDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditDialog(index, contentDiv.innerHTML);
            });

            const delBtn = itemDiv.querySelector('.delete-btn');
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSubject(index, itemDiv);
            });

            taskList.appendChild(itemDiv);
        } else {
            const btn = document.createElement('div');
            btn.className = 'restore-btn primary-btn';
            btn.setAttribute('data-name', '恢复 ' + subject.name);
            btn.innerHTML = `<span class="icon-mask" style="--icon-url: url('${subject.icon}')" aria-hidden="true"></span><s-ripple attached="true"></s-ripple>`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                restoreSubject(index);
            });
            restorePanel.appendChild(btn);
        }
    });

    await replaceIconMasks(taskList);
    await replaceIconMasks(restorePanel);
}

function resetAll() {
    //indexedDB.deleteDatabase('KanbanDB');
    localStorage.clear();
}

function deleteSubject(index, taskItem) {
    taskItem.style.opacity = '0';
    taskItem.style.transform = 'scale(0.9)';
    setTimeout(() => {
        appState[index].isDeleted = true;
        saveState();
        renderUI();
    }, 220);
}

function restoreSubject(index) {
    appState[index].isDeleted = false;
    saveState();
    renderUI();
}

function saveState() {
    localStorage.setItem('kanban_data', JSON.stringify(appState));
}

function updateTaskContent(index, newHtml) {
    const taskContent = document.querySelector(`.task-content[data-index="${index}"]`);
    if (taskContent) {
        taskContent.innerHTML = newHtml;
    }
    appState[index].content = newHtml;
    saveState();
    if (window.recomputeScale) window.recomputeScale();
}

// ==================== 5. 富文本编辑器 ====================
// 自定义文本样式扩展（支持 fontSize 和 fontFamily）
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
    };
  },
});

let editDialog = null;
let currentEditor = null;
let currentEditIndex = null;

function initRichEditorDialog() {
    editDialog = document.getElementById('text-edit-panel');
    const editorElement = document.getElementById('rich-editor');

    if (!editDialog || !editorElement) return;

    editorElement.style.lineHeight = '1.2';

    // 添加样式消除段落边距
    const style = document.createElement('style');
    style.textContent = '#rich-editor p { margin: 0; }';
    document.head.appendChild(style);

    currentEditor = new Editor({
        element: editorElement,
        extensions: [
            StarterKit.configure({
                textStyle: false,
                dropcursor: false, // 禁用拖拽光标扩展，避免错误
            }),
            CustomTextStyle,
            Image.configure({
                inline: true,
                allowBase64: true,
            }),
        ],
        content: '',
        onUpdate: ({ editor }) => {
            if (currentEditIndex !== null) {
                const html = editor.getHTML();
                updateTaskContent(currentEditIndex, html);
            }
        },
    });

    bindRichEditorButtons();

    const confirmBtn = document.getElementById('text-edit-confirm');
    const cancelBtn = document.getElementById('text-edit-cancel');

    if (confirmBtn) confirmBtn.onclick = () => (editDialog.showed = false);
    if (cancelBtn) cancelBtn.onclick = () => (editDialog.showed = false);
}

function bindRichEditorButtons() {
    const boldBtn = document.getElementById('bold-btn');
    if (boldBtn) {
        boldBtn.onclick = () => currentEditor?.chain().focus().toggleBold().run();
    }

    const sizeIncreaseBtn = document.getElementById('size-increase-btn');
    if (sizeIncreaseBtn) {
        sizeIncreaseBtn.onclick = () => {
            if (!currentEditor) return;
            let currentSize = 16;
            const attrs = currentEditor.getAttributes('textStyle');
            if (attrs.fontSize) {
                const match = attrs.fontSize.match(/\d+/);
                if (match) currentSize = parseInt(match[0]);
            }
            let newSize = currentSize + 4;
            if (newSize < 8) newSize = 8;
            if (newSize > 150) newSize = 150;
            currentEditor.chain().focus().setFontSize(`${newSize}px`).run();
            console.log('设置字号为', newSize);
        };
    }

    const sizeDecreaseBtn = document.getElementById('size-decrease-btn');
    if (sizeDecreaseBtn) {
        sizeDecreaseBtn.onclick = () => {
            if (!currentEditor) return;
            let currentSize = 16;
            const attrs = currentEditor.getAttributes('textStyle');
            if (attrs.fontSize) {
                const match = attrs.fontSize.match(/\d+/);
                if (match) currentSize = parseInt(match[0]);
            }
            let newSize = currentSize - 4;
            if (newSize < 8) newSize = 8;
            if (newSize > 150) newSize = 150;
            currentEditor.chain().focus().setFontSize(`${newSize}px`).run();
            console.log('设置字号为', newSize);
        };
    }

    const addImageBtn = document.getElementById('add-image-btn');
    if (addImageBtn) {
        addImageBtn.onclick = () => insertImageToEditor();
    }

    const fontPicker = document.getElementById('font-picker');
    if (fontPicker) {
        fontPicker.addEventListener('change', (e) => {
            const family = e.target.value;
            if (!currentEditor) return;
            if (family) {
                currentEditor.chain().focus().setFontFamily(family).run();
                console.log('设置字体为', family);
            } else {
                currentEditor.chain().focus().unsetFontFamily().run();
                console.log('清除字体');
            }
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
                currentEditor.chain().focus().setImage({ src: ev.target.result }).run();
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

function openEditDialog(index, currentHtml) {
    currentEditIndex = index;
    if (!currentEditor) return;
    currentEditor.commands.setContent(currentHtml || '');
    if (editDialog) editDialog.showed = true;
    setTimeout(() => {
        currentEditor.commands.focus();
        currentEditor.commands.selectAll();
    }, 50);
}


// ==================== 6. 主题应用 ====================
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
            const img = new Image();
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
    } catch (error) {
        console.error('主题生成失败，使用默认颜色', error);
        await createScheme('#9C4F4F', { page: pageElement });
    }
}

window.resetAll = resetAll;

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
    const bgFile = await getDB('background_img');
    if (bgFile) {
        const url = URL.createObjectURL(bgFile);
        applyBackgroundImage(url);
        await applyMaterialYouTheme(bgFile);
    } else {
        await applyMaterialYouTheme('#9C4F4F');
    }
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