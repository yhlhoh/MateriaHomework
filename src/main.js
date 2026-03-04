// ==================== 1. 导入Material You官方库和screenfull ====================
import {
    argbFromHex,
    themeFromSourceColor,
    hexFromArgb,
    sourceColorFromImageBytes,
} from '@material/material-color-utilities';
import screenfull from 'screenfull';

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

// ==================== 3. 全局状态 ====================
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

// ==================== 4. 背景采样与莫奈取色 (使用官方库) ====================

// 获取图片像素数据
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

// 从图片文件提取主色：使用官方库的 QuantizerCelebi + Score 流水线
async function extractPrimaryColorFromFile(file) {
    try {
        const pixelData = await getImageDataFromFile(file);
        // sourceColorFromImageBytes 内部调用官方库的 QuantizerCelebi 和 Score，
        // 完整实现背景采样与 Monet 取色逻辑，无需自行实现底层算法。
        const sourceArgb = sourceColorFromImageBytes(pixelData);
        return hexFromArgb(sourceArgb);
    } catch (error) {
        console.error('取色失败:', error);
        return '#6750A4';
    }
}

// 应用 Material You 主题
async function applyMaterialYouTheme(hexColor) {
    try {
        const sourceArgb = argbFromHex(hexColor);
        const theme = themeFromSourceColor(sourceArgb);

        const colors = {
            primary: hexFromArgb(theme.schemes.light.primary),
            onPrimary: hexFromArgb(theme.schemes.light.onPrimary),
            primaryContainer: hexFromArgb(theme.schemes.light.primaryContainer),
            secondary: hexFromArgb(theme.schemes.light.secondary),
            secondaryContainer: hexFromArgb(theme.schemes.light.secondaryContainer),
            tertiary: hexFromArgb(theme.schemes.light.tertiary),
            tertiaryContainer: hexFromArgb(theme.schemes.light.tertiaryContainer),
            surface: hexFromArgb(theme.schemes.light.surface),
            background: hexFromArgb(theme.schemes.light.background),
            onSurface: hexFromArgb(theme.schemes.light.onSurface)
        };
        console.log("TertiaryContainer:", colors.tertiaryContainer);
        document.documentElement.style.setProperty('--time-color', colors.primary);
        document.documentElement.style.setProperty('--item-bg', colors.secondaryContainer);
        document.documentElement.style.setProperty('--tag-bg', colors.tertiaryContainer);
        document.documentElement.style.setProperty('--text-color', colors.onSurface);
        document.documentElement.style.setProperty('--btn-hover', colors.tertiaryContainer);

        document.body.style.backgroundColor = colors.background;

        console.log('主题已应用，主色:', hexColor);
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
        document.documentElement.style.setProperty('--tag-bg', defaultColors.tertiaryContainer);
        document.documentElement.style.setProperty('--text-color', defaultColors.onSurface);
        document.documentElement.style.setProperty('--btn-hover', defaultColors.tertiaryContainer);
        return defaultColors;
    }
}

// ==================== 5. 图片操作 ====================
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

async function loadIages() {
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

// ==================== 6. 时钟 ====================
function updateClock() {
    const now = new Date();
    document.getElementById('hours').textContent = String(now.getHours()).padStart(2, '0');
    document.getElementById('minutes').textContent = String(now.getMinutes()).padStart(2, '0');
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    document.getElementById('date').textContent = `${days[now.getDay()]}, ${now.getMonth() + 1}月${now.getDate()}日`;
}

// ==================== 7. 初始化 ====================
setInterval(updateClock, 1000);
updateClock();
initData();
//loadImages();
getElementById('modal').remove()
getElementById('full-screen-btn').addEventListener('click',()=>{screenfull.toggle();})

// 如果没有背景图片，使用默认主题
setTimeout(() => {
    if (!document.body.style.backgroundImage || document.body.style.backgroundImage === 'url("assets/background.png")') {
        applyMaterialYouTheme('#9C4F4F'); // 默认暖棕色
    }
}, 500);
