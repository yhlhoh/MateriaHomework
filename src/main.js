// ==================== 1. 导入依赖 ====================
import {
    argbFromHex,
    themeFromSourceColor,
    hexFromArgb,
    sourceColorFromImageBytes,
} from '@material/material-color-utilities';
import screenfull from 'screenfull';
import html2canvas from 'html2canvas';

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
    for (const span of masks) {
        try {
            const iconUrlVar = span.style.getPropertyValue('--icon-url').trim();
            if (!iconUrlVar) continue;
            const matches = iconUrlVar.match(/url\(['"]?(.*?)['"]?\)/);
            if (!matches) continue;
            const url = matches[1];
            if (!url) continue;

            // 从缓存或网络获取SVG文本
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

            // 创建新的SVG元素 (保留原有属性)
            const newSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            // 复制所有属性
            for (const attr of svgEl.attributes) {
                newSvg.setAttribute(attr.name, attr.value);
            }
            // 移动子节点
            while (svgEl.firstChild) {
                newSvg.appendChild(svgEl.firstChild);
            }

            // 设置类: 保留原类并添加 icon-svg (移除可能冲突的mask样式)
            newSvg.setAttribute('class', span.className + ' icon-svg');
            // 强制使用 currentColor 以便主题控制
            newSvg.removeAttribute('fill');
            newSvg.setAttribute('fill', 'currentColor');
            // 确保viewBox存在（若缺失且宽高存在，粗略处理）
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
    }
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
    renderUI();
}

function renderUI() {
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
                <div class="task-content" contenteditable="true">${subject.content}</div>
                <button class="delete-btn" title="隐藏科目">×</button>
            `;

            const contentDiv = itemDiv.querySelector('.task-content');
            contentDiv.addEventListener('input', (e) => {
                appState[index].content = e.target.innerHTML;
                saveState();
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
            btn.innerHTML = `<span class="icon-mask" style="--icon-url: url('${subject.icon}')" aria-hidden="true"></span>`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                restoreSubject(index);
            });
            restorePanel.appendChild(btn);
        }
    });

    // 新DOM生成后，将里面的占位.icon-mask替换为内联SVG
    replaceIconMasks(taskList);
    replaceIconMasks(restorePanel);
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

// ==================== 5. 背景采样与莫奈取色 ====================
async function getImageDataFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                resolve(ctx.getImageData(0, 0, img.width, img.height).data);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function extractPrimaryColorFromFile(file) {
    try {
        const pixelData = await getImageDataFromFile(file);
        const sourceArgb = sourceColorFromImageBytes(pixelData);
        return hexFromArgb(sourceArgb);
    } catch (error) {
        console.error('取色失败:', error);
        return '#6750A4';
    }
}

async function applyMaterialYouTheme(hexColor) {
    try {
        const sourceArgb = argbFromHex(hexColor);
        const theme = themeFromSourceColor(sourceArgb);

        const colors = {
            primary: hexFromArgb(theme.schemes.light.primary),
            secondaryContainer: hexFromArgb(theme.schemes.light.secondaryContainer),
            tertiaryContainer: hexFromArgb(theme.schemes.light.tertiaryContainer),
            background: hexFromArgb(theme.schemes.light.background),
            onSurface: hexFromArgb(theme.schemes.light.onSurface)
        };
        
        document.documentElement.style.setProperty('--time-color', colors.tertiaryContainer);
        document.documentElement.style.setProperty('--item-bg', colors.secondaryContainer);
        document.documentElement.style.setProperty('--tag-bg', colors.tertiaryContainer);
        document.documentElement.style.setProperty('--text-color', colors.onSurface);
        document.documentElement.style.setProperty('--btn-hover', colors.tertiaryContainer);

        document.body.style.backgroundColor = colors.background;
        return colors;

    } catch (error) {
        console.warn('主题生成失败，使用默认颜色', error);
        const defaultColors = {
            primary: '#FFA3B1',
            secondaryContainer: '#FAE4E7',
            tertiaryContainer: '#FCE0C6',
            onSurface: '#3E1914'
        };
        document.documentElement.style.setProperty('--time-color', defaultColors.primary);
        document.documentElement.style.setProperty('--item-bg', defaultColors.secondaryContainer);
        document.documentElement.style.setProperty('--tag-bg', defaultColors.tertiary);
        document.documentElement.style.setProperty('--text-color', defaultColors.onSurface);
        document.documentElement.style.setProperty('--btn-hover', defaultColors.tertiaryContainer);
        return defaultColors;
    }
}

// ==================== 6. 图片操作 ====================
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
        const primaryColor = await extractPrimaryColorFromFile(bgFile);
        await applyMaterialYouTheme(primaryColor);
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

            const primaryColor = await extractPrimaryColorFromFile(file);
            await applyMaterialYouTheme(primaryColor);
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
    const img = document.createElement('img');
    img.src = url;
    img.title = "点击删除此图片";

    img.onclick = async function() {
        this.remove();
        URL.revokeObjectURL(url);
        savedCustomImages = savedCustomImages.filter(item => item.id !== id);
        await setDB('custom_images', savedCustomImages);
    };

    document.getElementById('custom-images-container').appendChild(img);
}

// ==================== 7. 时钟 ====================
function updateClock() {
    const now = new Date();
    document.getElementById('hours').textContent = String(now.getHours()).padStart(2, '0');
    document.getElementById('minutes').textContent = String(now.getMinutes()).padStart(2, '0');
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    document.getElementById('date').textContent = `${days[now.getDay()]}, ${now.getMonth() + 1}月${now.getDate()}日`;
}

// ==================== 8. 截图导出优化 ====================
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

// ==================== 9. 初始化 ====================
setInterval(updateClock, 1000);
updateClock();
initData();
loadImages();

// 替换左下角固定按钮中的图标 (等待DOM就绪)
setTimeout(() => {
    replaceIconMasks(document.querySelector('.controls'));
}, 100);

// 设置默认主题 (如果没有背景图片)
setTimeout(() => {
    if (!document.body.style.backgroundImage || document.body.style.backgroundImage === 'url("assets/background.png")') {
        applyMaterialYouTheme('#9C4F4F');
    }
}, 500);

// 移除加载模态框
window.addEventListener('load', function () {
    const modal = document.querySelector('.loading-modal');
    if (modal) modal.remove();
});

// 全屏按钮事件
document.getElementById('full-screen-btn').addEventListener('click', () => { 
    if (screenfull.isEnabled) screenfull.toggle(); 
});