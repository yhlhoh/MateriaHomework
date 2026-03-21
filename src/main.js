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

// ==================== 5. 主题色板核心 (Palette & Theme) ====================

class PaletteScheme {
  static mergeCorePalette({ primary, secondary, tertiary, neutral }) {
    const pCore = CorePalette.of(primary);
    return {
      pCore,
      sCore: secondary ? CorePalette.of(secondary) : pCore,
      tCore: tertiary ? CorePalette.of(tertiary) : pCore,
      nCore: neutral ? CorePalette.of(neutral) : pCore
    };
  }

  static mergeTonal({ secondary, tertiary }) {
    return {
      sTonal: secondary ? 'a1' : 'a2',
      tTonal: tertiary ? 'a1' : 'a3'
    };
  }
}

/**
 * 提高颜色的对比度/鲜艳度
 * @param {number} argbInt - 原始的 ARGB 整数颜色
 * @param {number} toneOffset - 明度偏移量（负数变暗，正数变亮）
 * @param {number} chromaOffset - 饱和度偏移量（正数变鲜艳）
 */
function enhanceContrast(argbInt, toneOffset = -10, chromaOffset = 15) {
    const hct = Hct.fromInt(argbInt);
    
    // 亮色模式下，稍微降低 Tone(变得更深一点) 可以显著提高与浅色背景的对比度
    hct.tone = Math.max(0, Math.min(100, hct.tone + toneOffset));
    
    // 提高 Chroma 可以让颜色摆脱灰暗，变得更鲜艳夺目
    hct.chroma = hct.chroma + chromaOffset;
    
    return hct.toInt();
}
class ThemeScheme {
  static sourceToLight(source) {
    const { pCore, sCore, tCore, nCore } = PaletteScheme.mergeCorePalette(source);
    const { sTonal, tTonal } = PaletteScheme.mergeTonal(source);
    return {
      primary: pCore.a1.tone(40),
      onPrimary: pCore.a1.tone(100),
      primaryContainer: pCore.a1.tone(90),
      onPrimaryContainer: pCore.a1.tone(10),
      secondary: sCore[sTonal].tone(40),
      onSecondary: sCore[sTonal].tone(100),
      secondaryContainer: sCore[sTonal].tone(90),
      onSecondaryContainer: sCore[sTonal].tone(10),
      tertiary: tCore[tTonal].tone(40),
      onTertiary: tCore[tTonal].tone(100),
      tertiaryContainer: tCore[tTonal].tone(90),
      onTertiaryContainer: tCore[tTonal].tone(10),
      error: pCore.error.tone(40),
      onError: pCore.error.tone(100),
      errorContainer: pCore.error.tone(90),
      onErrorContainer: pCore.error.tone(10),
      background: nCore.n1.tone(99),
      onBackground: nCore.n1.tone(10),
      surface: nCore.n1.tone(99),
      onSurface: nCore.n1.tone(10),
      surfaceVariant: pCore.n2.tone(90),
      onSurfaceVariant: pCore.n2.tone(30),
      outline: pCore.n2.tone(50),
      outlineVariant: pCore.n2.tone(80),
      shadow: pCore.n1.tone(0),
      scrim: pCore.n1.tone(0),
      inverseSurface: pCore.n1.tone(20),
      inverseOnSurface: pCore.n1.tone(95),
      inversePrimary: pCore.a1.tone(80)
    };
  }

  static sourceToDark(source) {
    const { pCore, sCore, tCore, nCore } = PaletteScheme.mergeCorePalette(source);
    const { sTonal, tTonal } = PaletteScheme.mergeTonal(source);
    return {
      primary: pCore.a1.tone(80),
      onPrimary: pCore.a1.tone(20),
      primaryContainer: pCore.a1.tone(30),
      onPrimaryContainer: pCore.a1.tone(90),
      secondary: sCore[sTonal].tone(80),
      onSecondary: sCore[sTonal].tone(20),
      secondaryContainer: sCore[sTonal].tone(30),
      onSecondaryContainer: sCore[sTonal].tone(90),
      tertiary: tCore[tTonal].tone(80),
      onTertiary: tCore[tTonal].tone(20),
      tertiaryContainer: tCore[tTonal].tone(30),
      onTertiaryContainer: tCore[tTonal].tone(90),
      error: pCore.error.tone(80),
      onError: pCore.error.tone(20),
      errorContainer: pCore.error.tone(30),
      onErrorContainer: pCore.error.tone(80),
      background: nCore.n1.tone(10),
      onBackground: nCore.n1.tone(90),
      surface: nCore.n1.tone(10),
      onSurface: nCore.n1.tone(90),
      surfaceVariant: pCore.n2.tone(30),
      onSurfaceVariant: pCore.n2.tone(80),
      outline: pCore.n2.tone(60),
      outlineVariant: pCore.n2.tone(30),
      shadow: pCore.n1.tone(0),
      scrim: pCore.n1.tone(0),
      inverseSurface: pCore.n1.tone(90),
      inverseOnSurface: pCore.n1.tone(20),
      inversePrimary: pCore.a1.tone(40)
    };
  }
}

// ==================== 6. 背景采样与主题应用 ====================
const getImageData = async (image) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      reject(new Error('Could not get canvas context'));
      return;
    }
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      context.drawImage(img, 0, 0);
      resolve(context.getImageData(0, 0, img.width, img.height).data);
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = image;
  });
};

const getPixelArray = (imageData, quality) => {
  const pixels = [];
  for (let i = 0; i < imageData.length; i += quality*4) {
    const offset = i * 4;
    const r = imageData[offset];
    const g = imageData[offset + 1];
    const b = imageData[offset + 2];
    const a = imageData[offset + 3];

    if (typeof a === 'undefined' || a >= 125) {
      if (!(r > 250 && g > 250 && b > 250)) {
        const argb = argbFromRgb(r, g, b);
        pixels.push(argb);
      }
    }
  }
  return pixels;
};

const colorFromImageUrl = async (image, quality = 10) => {
  const imageData = await getImageData(image);
  const pixelArray = getPixelArray(imageData, quality);
  const result = QuantizerCelebi.quantize(pixelArray, 128);
  const ranked = Score.score(result);
  return ranked[0]; 
};

async function extractPrimaryColorFromFile(file) {
    const url = URL.createObjectURL(file);
    try {
        const argbColor = await colorFromImageUrl(url);
        return hexFromArgb(argbColor);
    } catch (error) {
        console.error('提取主色失败，使用默认颜色', error);
        return '#9C4F4F';
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function applyMaterialYouTheme(hexColor) {
    try {
        const sourceArgb = argbFromHex(hexColor);
        
        // 使用自定义类生成亮色模式的所有颜色 (ARGB整数)
        const schemeArgb = ThemeScheme.sourceToLight({ primary: sourceArgb });
        
        // 转换 ARGB 整数到 Hex 字符串
        const colors = {};
        for (const [key, value] of Object.entries(schemeArgb)) {
            colors[key] = hexFromArgb(value);
        }
        
        // 应用到 DOM 变量
        document.documentElement.style.setProperty('--time-color', colors.primary);
        document.documentElement.style.setProperty('--item-bg', colors.secondaryContainer);
        document.documentElement.style.setProperty('--tag-bg', colors.tertiaryContainer);
        document.documentElement.style.setProperty('--text-color', colors.onSurface);
        document.documentElement.style.setProperty('--btn-hover', colors.tertiaryContainer);

        document.body.style.backgroundColor = colors.background;
        return colors;

    } catch (error) {
        console.warn('主题生成失败，使用默认颜色', error);
        const defaultColors = {
            primaryContainer: '#FFA3B1',
            secondaryContainer: '#FAE4E7',
            tertiaryContainer: '#FCE0C6',
            onSurface: '#3E1914'
        };
        document.documentElement.style.setProperty('--time-color', defaultColors.primaryContainer);
        document.documentElement.style.setProperty('--item-bg', defaultColors.secondaryContainer);
        document.documentElement.style.setProperty('--tag-bg', defaultColors.tertiaryContainer);
        document.documentElement.style.setProperty('--text-color', defaultColors.onSurface);
        document.documentElement.style.setProperty('--btn-hover', defaultColors.tertiaryContainer);
        return defaultColors;
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

// ==================== 8. 时钟 ====================
function updateClock() {
    const now = new Date();
    document.getElementById('hours').textContent = String(now.getHours()).padStart(2, '0');
    document.getElementById('minutes').textContent = String(now.getMinutes()).padStart(2, '0');
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    document.getElementById('date').textContent = `${days[now.getDay()]}, ${now.getMonth() + 1}月${now.getDate()}日`;
}

// ==================== 9. 截图导出优化 ====================
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

// ==================== 10. 初始化 ====================
setInterval(updateClock, 1000);
updateClock();
initData();
loadImages();

setTimeout(() => {
    replaceIconMasks(document.querySelector('.controls'));
}, 100);

setTimeout(() => {
    if (!document.body.style.backgroundImage || document.body.style.backgroundImage === 'url("assets/background.png")') {
        applyMaterialYouTheme('#9C4F4F');
    }
}, 500);

window.addEventListener('load', function () {
    const modal = document.querySelector('.loading-modal');
    if (modal) modal.remove();
});

document.getElementById('full-screen-btn').addEventListener('click', () => { 
    if (screenfull.isEnabled) screenfull.toggle(); 
});

document.addEventListener("DOMContentLoaded", () => {
    const root = document.documentElement;
    const panel = document.querySelector(".right-panel");
    if (!panel) return;

    const MIN_SCALE = 0.55;
    const MAX_SCALE = 1;
    const EPS = 0.002;

    let rafId = 0;

    function setScale(v) {
        root.style.setProperty("--task-scale", String(v));
    }

    function clearInlineFontSize() {
        panel.querySelectorAll(".task-content").forEach(el => {
            el.style.fontSize = "";
        });
    }

    function fits() {
        return panel.scrollHeight <= panel.clientHeight + 0.5;
    }

    function recomputeScale() {
        clearInlineFontSize();

        setScale(MAX_SCALE);
        panel.getBoundingClientRect();

        if (fits()) return;

        let lo = MIN_SCALE;
        let hi = MAX_SCALE;

        while (hi - lo > EPS) {
            const mid = (lo + hi) / 2;
            setScale(mid);
            panel.getBoundingClientRect();

            if (fits()) lo = mid;
            else hi = mid;
        }

        setScale(lo);
    }

    function schedule() {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(recomputeScale);
    }

    panel.addEventListener("input", schedule, true);

    const mo = new MutationObserver(schedule);
    mo.observe(panel, { childList: true, subtree: true, characterData: true });

    const ro = new ResizeObserver(schedule);
    ro.observe(panel);
    ro.observe(document.body);

    window.addEventListener("resize", schedule);

    requestAnimationFrame(() => requestAnimationFrame(recomputeScale));
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('Service Worker 注册成功:', registration.scope);
      })
      .catch(error => {
        console.log('Service Worker 注册失败:', error);
      });
  });
}