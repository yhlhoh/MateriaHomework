// ==================== 导入依赖 ====================
import screenfull from 'screenfull';
import html2canvas from 'html2canvas';
import 'sober';
// 本地打包 sober 的滚动条样式，避免离线时依赖 unpkg CDN
import 'sober/style/scroll-view.css';
import { createScheme } from 'sober-theme';
import { Hct, QuantizerCelebi, Score, argbFromHex, argbFromRgb, hexFromArgb } from '@material/material-color-utilities';
import { registerSW } from 'virtual:pwa-register';
import { createRichTextEditor } from './richTextEditor';
import changelogText from '../CHANGELOG.txt?raw';
import dayjs from 'dayjs';

// ==================== Dialog 工具（sober <s-dialog> 封装） ====================
const Dialog = {
    /**
     * @param {{ headline?: string, text?: string, actions?: Array<{text: string, click?: () => (void|Promise<void>)}>} } opts
     */
    builder(opts = {}) {
        const headline = String(opts.headline ?? '');
        const text = String(opts.text ?? '');
        const actions = Array.isArray(opts.actions) && opts.actions.length > 0
            ? opts.actions
            : [{ text: '确定' }];

        const dialog = document.createElement('s-dialog');
        const headlineDiv = document.createElement('div');
        headlineDiv.slot = 'headline';
        headlineDiv.textContent = headline;

        const textDiv = document.createElement('div');
        textDiv.slot = 'text';
        textDiv.textContent = text;
        // 让 changelog 这类多行文本更易读；短文本也不会受影响
        textDiv.style.whiteSpace = 'pre-wrap';
        textDiv.style.wordBreak = 'break-word';
        dialog.appendChild(headlineDiv);
        dialog.appendChild(textDiv);

        actions.forEach((a) => {
            const btn = document.createElement('s-button');
            btn.slot = 'action';
            btn.type = 'text';
            btn.textContent = String(a?.text ?? '');
            btn.addEventListener('click', async () => {
                dialog.showed = false;
                try {
                    if (typeof a?.click === 'function') {
                        await a.click();
                    }
                } finally {
                    // 给关闭动画一点时间
                    setTimeout(() => dialog.remove(), 180);
                }
            });
            dialog.appendChild(btn);
        });

        document.body.appendChild(dialog);
        // 下一帧再展示，避免初次挂载时闪烁
        requestAnimationFrame(() => {
            dialog.showed = true;
        });
        return dialog;
    },
};

// ==================== IndexedDB存储 ====================
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

// ==================== 内联SVG替换器 ====================
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

// ==================== 全局状态与看板逻辑 ====================
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
            if (Array.isArray(parsed)) {
                const defaultMap = new Map(defaultSubjects.map(s => [s.id, s]));
                appState = parsed
                    .filter(p => p && typeof p === 'object' && typeof p.id === 'string')
                    .map(p => {
                        const def = defaultMap.get(p.id);
                        const base = def
                            ? { ...def }
                            : {
                                id: p.id,
                                name: p.name || '未命名',
                                icon: p.icon || '',
                                content: '',
                                isDeleted: false,
                            };
                        return {
                            ...base,
                            ...p,
                            name: (p.name ?? base.name) || '未命名',
                            icon: (p.icon ?? base.icon) || '',
                            content: (p.content ?? '') || '',
                            isDeleted: Boolean(p.isDeleted),
                        };
                    });
            } else {
                appState = JSON.parse(JSON.stringify(defaultSubjects));
            }
        } catch (e) {
            appState = JSON.parse(JSON.stringify(defaultSubjects));
        }
    } else {
        appState = JSON.parse(JSON.stringify(defaultSubjects));
    }
    return renderUI();
}

// ==================== 版本号 + 更新日志提示 ====================
const APP_VERSION_STORAGE_KEY = 'materia_homework_last_version';
const APP_USED_STORAGE_KEY = 'materia_homework_used';

async function fetchCurrentVersion() {
    try {
        const response = await fetch('/version.txt', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const version = (await response.text()).trim();
        if (!version || version.startsWith('<!DOCTYPE')) throw new Error('No Version Found');
        return version;
    } catch (err) {
        console.error('Failed to fetch version file:', err);
        return null;
    }
}

function hasLocalUsageRecord() {
    // “有使用记录”按最简单、最稳妥的判定：存在看板数据 / 主题缓存 / 显式 used 标记
    return Boolean(
        localStorage.getItem('kanban_data') ||
        localStorage.getItem(PRIMARY_COLOR_CACHE_KEY) ||
        localStorage.getItem(APP_USED_STORAGE_KEY) === '1',
    );
}

async function maybeShowChangelogOnce() {
    const version = await fetchCurrentVersion();
    const versionInfoEl = document.getElementById('version-info');
    if (versionInfoEl) versionInfoEl.innerText = version || '';
    if (!version) return;

    const usedBefore = hasLocalUsageRecord();
    const prevVersion = localStorage.getItem(APP_VERSION_STORAGE_KEY);

    // 先写入 used 标记：让首次使用不弹，后续版本变更可弹
    localStorage.setItem(APP_USED_STORAGE_KEY, '1');

    const versionChanged = Boolean(prevVersion) && prevVersion !== version;
    if (usedBefore && versionChanged) {
        const text = String(changelogText || '').trim();
        if (text) {
            Dialog.builder({
                headline: '更新日志',
                text,
                actions: [{ text: '关闭' }],
            });
        }
    }

    // 无论是否弹窗，都更新本地记录，确保“每个版本最多弹一次”
    localStorage.setItem(APP_VERSION_STORAGE_KEY, version);
}

async function renderUI() {
    const taskList = document.getElementById('task-list');
    const restorePanel = document.getElementById('restore-panel');

    taskList.innerHTML = '';

    appState.forEach((subject) => {
        if (!subject.isDeleted) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'task-item';
            const iconHtml = subject.icon
                ? `<span class="icon-mask" style="--icon-url: url('${subject.icon}')" aria-hidden="true"></span>`
                : '';
            itemDiv.innerHTML = `
                <div class="subject-tag">
                    ${iconHtml}
                    <span>${subject.name}</span>
                </div>
                <div class="task-content" data-id="${subject.id}">${subject.content}</div>
                <s-ripple attached="true"></s-ripple>
            `;

            const contentDiv = itemDiv.querySelector('.task-content');
            contentDiv.removeAttribute('contenteditable');
            const taskId = subject.id;
            contentDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditDialog(taskId, contentDiv.innerHTML);
            });

            taskList.appendChild(itemDiv);
        }
    });

    await replaceIconMasks(taskList);
}

// ==================== 科目管理功能 ====================
let draggedSubject = null;

let subjectManagePrevPositions = null;

function createDragGhost(fromEl) {
    const ghost = fromEl.cloneNode(true);
    ghost.style.position = 'fixed';
    ghost.style.left = '0px';
    ghost.style.top = '0px';
    ghost.style.zIndex = '2147483647';
    ghost.style.pointerEvents = 'none';
    ghost.style.margin = '0';
    ghost.style.width = `${fromEl.getBoundingClientRect().width}px`;
    ghost.style.opacity = '0.85';
    ghost.style.transform = 'translate(-9999px, -9999px)';
    ghost.style.boxShadow = '0 10px 24px rgba(0,0,0,0.18)';
    ghost.style.border = '1px solid rgba(0,0,0,0.06)';
    ghost.style.backdropFilter = 'blur(6px)';
    return ghost;
}

function positionDragGhost(ghost, clientX, clientY) {
    if (!ghost) return;
    // 让预览略偏移，避免遮挡指示线
    const dx = 12;
    const dy = 12;
    ghost.style.transform = `translate(${clientX + dx}px, ${clientY + dy}px)`;
}

function startAutoScroll(container, getPointerY) {
    if (!container) return () => {};
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const EDGE = 36;
    const MAX_STEP = prefersReduced ? 18 : 26;
    let rafId = 0;
    let running = true;

    const tick = () => {
        if (!running) return;
        const y = getPointerY();
        const rect = container.getBoundingClientRect();
        let delta = 0;

        if (y < rect.top + EDGE) {
            const t = clamp((rect.top + EDGE - y) / EDGE, 0, 1);
            delta = -Math.ceil(t * MAX_STEP);
        } else if (y > rect.bottom - EDGE) {
            const t = clamp((y - (rect.bottom - EDGE)) / EDGE, 0, 1);
            delta = Math.ceil(t * MAX_STEP);
        }

        if (delta !== 0) {
            container.scrollTop += delta;
        }

        rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
        running = false;
        cancelAnimationFrame(rafId);
    };
}

function captureSubjectManagePositions(container) {
    const map = new Map();
    if (!container) return map;
    container.querySelectorAll('.subject-manage-item').forEach(el => {
        const id = el.getAttribute('data-id');
        if (!id) return;
        map.set(id, el.getBoundingClientRect());
    });
    return map;
}

function animateSubjectManageFromPositions(container, prevPositions) {
    if (!container || !prevPositions || prevPositions.size === 0) return;
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReduced) return;

    container.querySelectorAll('.subject-manage-item').forEach(el => {
        const id = el.getAttribute('data-id');
        if (!id) return;
        const prev = prevPositions.get(id);
        if (!prev) return;
        const next = el.getBoundingClientRect();
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

        el.animate(
            [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'translate(0px, 0px)' },
            ],
            {
                duration: 220,
                easing: 'cubic-bezier(0.2, 0, 0, 1)',
            },
        );
    });
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function moveSubjectInState(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= appState.length || toIndex >= appState.length) return;
    const [moved] = appState.splice(fromIndex, 1);
    appState.splice(toIndex, 0, moved);
}

function getManageItemElFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    return el.closest?.('.subject-manage-item') || null;
}

function attachPointerSort(handleEl, itemEl) {
    if (!handleEl || !itemEl) return;
    // 触屏/部分浏览器不支持 HTML5 DnD：用 PointerEvents 作为兼容排序
    handleEl.style.touchAction = 'none';

    const onPointerDown = (e) => {
        // 只允许主键拖拽
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const draggedId = itemEl.getAttribute('data-id');
        if (!draggedId) return;

        let lastOverId = null;
        let lastInsertAfter = false;

        const container = document.getElementById('subject-list-container');
        let lastPointerX = e.clientX;
        let lastPointerY = e.clientY;
        const stopAutoScroll = startAutoScroll(container, () => lastPointerY);

        const ghost = createDragGhost(itemEl);
        document.body.appendChild(ghost);
        positionDragGhost(ghost, lastPointerX, lastPointerY);

        itemEl.classList.add('is-dragging');
        itemEl.style.opacity = '0.6';

        try {
            handleEl.setPointerCapture(e.pointerId);
        } catch {
            // ignore
        }

        // 只记住当前高亮的那一项，避免每次 pointermove 都对所有列表项做一遍
        // querySelectorAll + 写样式（拖拽时这是每帧都在跑的路径）
        let indicatorEl = null;
        const clearIndicators = () => {
            if (!indicatorEl) return;
            indicatorEl.style.borderTop = '';
            indicatorEl.style.borderBottom = '';
            indicatorEl = null;
        };
        const setIndicator = (el, insertAfter) => {
            clearIndicators();
            el.style.borderTop = insertAfter ? '' : '2px solid var(--s-color-primary, #FFA3B1)';
            el.style.borderBottom = insertAfter ? '2px solid var(--s-color-primary, #FFA3B1)' : '';
            indicatorEl = el;
        };

        const onMove = (ev) => {
            lastPointerX = ev.clientX;
            lastPointerY = ev.clientY;
            positionDragGhost(ghost, lastPointerX, lastPointerY);

            const overEl = getManageItemElFromPoint(ev.clientX, ev.clientY);
            if (!overEl || overEl === itemEl) {
                clearIndicators();
                return;
            }
            const overId = overEl.getAttribute('data-id');
            if (!overId) return;

            const rect = overEl.getBoundingClientRect();
            const insertAfter = ev.clientY > rect.top + rect.height / 2;
            if (indicatorEl === overEl && lastOverId === overId && lastInsertAfter === insertAfter) {
                return; // 状态没变就不要再动 DOM
            }
            setIndicator(overEl, insertAfter);
            lastOverId = overId;
            lastInsertAfter = insertAfter;
        };

        const onUp = () => {
            stopAutoScroll();
            ghost.remove();

            itemEl.classList.remove('is-dragging');
            itemEl.style.opacity = '1';
            clearIndicators();

            if (lastOverId && lastOverId !== draggedId) {
                const beforePositions = captureSubjectManagePositions(container);
                const fromIndex = appState.findIndex(s => s.id === draggedId);
                let toIndex = appState.findIndex(s => s.id === lastOverId);
                if (fromIndex !== -1 && toIndex !== -1) {
                    if (lastInsertAfter) toIndex += 1;
                    // 从前往后移动时，移除元素会导致目标 index -1
                    if (fromIndex < toIndex) toIndex -= 1;
                    toIndex = clamp(toIndex, 0, appState.length - 1);
                    moveSubjectInState(fromIndex, toIndex);
                    saveState();
                    renderUI();
                    subjectManagePrevPositions = beforePositions;
                    renderSubjectManageDialog();
                }
            }

            handleEl.removeEventListener('pointermove', onMove);
            handleEl.removeEventListener('pointerup', onUp);
            handleEl.removeEventListener('pointercancel', onUp);
        };

        handleEl.addEventListener('pointermove', onMove);
        handleEl.addEventListener('pointerup', onUp);
        handleEl.addEventListener('pointercancel', onUp);
    };

    handleEl.addEventListener('pointerdown', onPointerDown);
}

async function renderSubjectManageDialog() {
    const container = document.getElementById('subject-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    appState.forEach((subject, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'subject-manage-item';
        itemDiv.draggable = true;
        itemDiv.setAttribute('data-id', subject.id);
        itemDiv.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background-color: var(--s-color-surface-variant, #FAE4E7);
            border-radius: 12px;
            cursor: move;
            transition: background-color 0.2s, transform 0.2s;
            user-select: none;
        `;
        itemDiv.style.willChange = 'transform';
        itemDiv.style.animation = 'fadeIn 0.25s ease forwards';
        
        const iconHtml = subject.icon
            ? `<span class="icon-mask" style="--icon-url: url('${subject.icon}'); width: 24px; height: 24px; display: inline-block;" aria-hidden="true"></span>`
            : '';

        itemDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <span class="subject-drag-handle" style="cursor: grab; color: var(--s-color-on-surface, #3E1914); opacity: 0.6; font-size: 20px;">≡</span>
                ${iconHtml}
                <span style="font-weight: 500; color: var(--s-color-on-surface, #3E1914);">${subject.name}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <s-switch id="switch-${subject.id}"></s-switch>
                <s-icon-button id="delete-${subject.id}" type="standard" style="color: var(--s-color-error, #d32f2f);">
                    <span class="icon-mask" style="--icon-url: url('assets/clear.svg')" aria-hidden="true"></span>
                </s-icon-button>
            </div>
        `;
        
        // 拖动事件
        itemDiv.addEventListener('dragstart', (e) => {
            // 仅允许从“≡”手柄开始拖拽，避免开关/按钮误触
            const fromHandle = e.target?.closest?.('.subject-drag-handle');
            if (!fromHandle) {
                e.preventDefault();
                return;
            }
            draggedSubject = subject;
            itemDiv.style.opacity = '0.5';
            itemDiv.style.transform = 'scale(1.01)';
            // Firefox 需要 setData 才会触发拖拽
            try {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', subject.id);
            } catch {
                // ignore
            }
        });
        
        itemDiv.addEventListener('dragend', (e) => {
            itemDiv.style.opacity = '1';
            itemDiv.style.transform = '';
            draggedSubject = null;
        });
        
        itemDiv.addEventListener('dragover', (e) => {
            e.preventDefault();
            // 拖拽靠近边缘时自动滚动（增强可用性）
            const container = document.getElementById('subject-list-container');
            if (container) {
                const rect = container.getBoundingClientRect();
                const EDGE = 36;
                const MAX_STEP = 22;
                if (e.clientY < rect.top + EDGE) {
                    const t = clamp((rect.top + EDGE - e.clientY) / EDGE, 0, 1);
                    container.scrollTop -= Math.ceil(t * MAX_STEP);
                } else if (e.clientY > rect.bottom - EDGE) {
                    const t = clamp((e.clientY - (rect.bottom - EDGE)) / EDGE, 0, 1);
                    container.scrollTop += Math.ceil(t * MAX_STEP);
                }
            }
            if (draggedSubject && draggedSubject.id !== subject.id) {
                const rect = itemDiv.getBoundingClientRect();
                const insertAfter = e.clientY > rect.top + rect.height / 2;
                itemDiv.style.borderTop = insertAfter ? '' : '2px solid var(--s-color-primary, #FFA3B1)';
                itemDiv.style.borderBottom = insertAfter ? '2px solid var(--s-color-primary, #FFA3B1)' : '';
            }
        });
        
        itemDiv.addEventListener('dragleave', (e) => {
            itemDiv.style.borderTop = '';
            itemDiv.style.borderBottom = '';
        });
        
        itemDiv.addEventListener('drop', (e) => {
            e.preventDefault();
            itemDiv.style.borderTop = '';
            itemDiv.style.borderBottom = '';
            if (!draggedSubject || draggedSubject.id === subject.id) return;

            const beforePositions = captureSubjectManagePositions(container);
            
            const draggedIndex = appState.findIndex(s => s.id === draggedSubject.id);
            const targetIndex = appState.findIndex(s => s.id === subject.id);
            
            if (draggedIndex !== -1 && targetIndex !== -1) {
                // 插入式排序（更符合“排序”直觉）
                let toIndex = targetIndex;
                const rect = itemDiv.getBoundingClientRect();
                const insertAfter = e.clientY > rect.top + rect.height / 2;
                if (insertAfter) toIndex += 1;
                if (draggedIndex < toIndex) toIndex -= 1;
                toIndex = clamp(toIndex, 0, appState.length - 1);
                moveSubjectInState(draggedIndex, toIndex);
                saveState();
                renderUI();
                subjectManagePrevPositions = beforePositions;
                renderSubjectManageDialog();
            }
        });

        // 触屏拖拽排序（手柄）
        const handleEl = itemDiv.querySelector('.subject-drag-handle');
        attachPointerSort(handleEl, itemDiv);
        
        container.appendChild(itemDiv);
        
        // 开关事件 - 设置初始状态并绑定事件
        const switchEl = itemDiv.querySelector(`#switch-${subject.id}`);
        if (switchEl) {
            // 设置初始checked状态
            switchEl.checked = !subject.isDeleted;
            switchEl.addEventListener('change', () => {
                subject.isDeleted = !switchEl.checked;
                saveState();
                renderUI();
            });
        }
        
        // 删除按钮事件
        const deleteBtn = itemDiv.querySelector(`#delete-${subject.id}`);
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                const container = document.getElementById('subject-list-container');
                const beforePositions = captureSubjectManagePositions(container);

                // 先动画，再真正删除
                const row = deleteBtn.closest?.('.subject-manage-item') || itemDiv;
                const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
                const doRemove = () => {
                    const deleteIndex = appState.findIndex(s => s.id === subject.id);
                    if (deleteIndex !== -1) {
                        appState.splice(deleteIndex, 1);
                        saveState();
                        renderUI();
                        subjectManagePrevPositions = beforePositions;
                        renderSubjectManageDialog();
                    }
                };

                Dialog.builder({
                    headline: '提示',
                    text: '确认删除吗？',
                    actions: [
                        { text: '取消' },
                        {
                            text: '确定',
                            click: async () => {
                                if (prefersReduced) {
                                    doRemove();
                                    return;
                                }

                                const h = row.getBoundingClientRect().height;
                                row.style.height = `${h}px`;
                                row.style.overflow = 'hidden';
                                row.style.transition = 'opacity 180ms ease, transform 180ms ease, height 220ms cubic-bezier(0.2, 0, 0, 1), margin 220ms cubic-bezier(0.2, 0, 0, 1), padding 220ms cubic-bezier(0.2, 0, 0, 1)';

                                requestAnimationFrame(() => {
                                    row.style.opacity = '0';
                                    row.style.transform = 'scale(0.98)';
                                    row.style.height = '0px';
                                    row.style.marginTop = '0px';
                                    row.style.marginBottom = '0px';
                                    row.style.paddingTop = '0px';
                                    row.style.paddingBottom = '0px';
                                });

                                const timer = setTimeout(doRemove, 240);
                                row.addEventListener(
                                    'transitionend',
                                    () => {
                                        clearTimeout(timer);
                                        doRemove();
                                    },
                                    { once: true },
                                );
                            },
                        },
                    ],
                });
            });
        }
    });
    
    await replaceIconMasks(container);

    // 排序/删除后平滑位移过渡
    animateSubjectManageFromPositions(container, subjectManagePrevPositions);
    subjectManagePrevPositions = captureSubjectManagePositions(container);
}

async function openSubjectManageDialog() {
    const dialog = document.getElementById('subject-manage-dialog');
    if (dialog) {
        await renderSubjectManageDialog();
        dialog.showed = true;
    }
}

function openAddSubjectDialog() {
    // 重置表单状态
    const nameInput = document.getElementById('new-subject-name');
    const iconPicker = document.getElementById('new-subject-icon');
    
    if (nameInput) nameInput.value = '';
    if (iconPicker) iconPicker.value = '';
    
    const dialog = document.getElementById('add-subject-dialog');
    if (dialog) {
        dialog.showed = true;
    }
}

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

// ==================== 主题应用 + 主色缓存 ====================
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

// 把主题真正写到 s-page 的 inline style 上（createScheme 会整段替换 cssText）
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

// ==================== 显示模式（浅色 / 深色 / 跟随系统 / 跟随取色） ====================
// sober 的 createScheme 同时产出浅色 --s-color-* 与深色 --s-color-dark-* 两套变量，
// s-page 的 theme 属性（light/auto/dark）会在 [dark] 下把前者重映射到后者，
// 所以暗色不需要另建配色，同一颗取色种子即可。
const THEME_MODE_STORAGE_KEY = 'materia_theme_mode';
const THEME_MODES = ['color', 'auto', 'light', 'dark'];
const THEME_MODE_LABELS = {
    color: '跟随取色',
    auto: '跟随系统',
    light: '始终浅色',
    dark: '始终深色',
};
// 判断明暗用的 tone 阈值（0=黑 100=白）。
// 跟随取色模式下：来源是图片时比的是整张图的平均 tone，来源是颜色时比的是该颜色的 tone。
// 参考值：#1B1035=7.8、深蓝 #1B3A5C≈22、#6750A4=40.1、默认壁纸 default.png 平均 tone≈89。
// 想让更多图片/颜色触发深色就调高这个数。
const DARK_SOURCE_TONE = 40;
const DEFAULT_THEME_MODE = 'color';

let themeMode = DEFAULT_THEME_MODE;
let lastSeedTone = null;

function normalizeThemeMode(value) {
    return THEME_MODES.includes(value) ? value : DEFAULT_THEME_MODE;
}

// 取色前先把图缩到这个尺寸以内，见 extractSeedArgb 的说明
const SEED_IMAGE_MAX_SIZE = 256;

/**
 * 从图片里取种子色，并算出这张图整体的明暗。
 * 算法与 mc-utilities 的 sourceColorFromImage 一致（只用不透明像素 ->
 * QuantizerCelebi -> Score），区别是先把图缩到 SEED_IMAGE_MAX_SIZE 以内。
 * 原实现按全分辨率取像素：默认壁纸是 3840x2160，要处理 8.29M 个像素，
 * 实测构造像素数组 868ms + 量化 2337ms ≈ 3.2 秒，还要分配 32MB 的 ImageData
 * 和几十 MB 的 JS 数组；缩到 256px 后同一张图量化约 0.4 秒，主色与 tone 结论一致
 * （都是 #d9d7fa / tone 87，属浅色）。
 * @returns {{argb: number, averageArgb: number, averageTone: number}|null}
 *   argb 是取出的种子色；averageArgb 是整张图的平均色，averageTone 是它的 HCT tone
 *   （0 黑 ~ 100 白）。平均色用于两处：深色模式按图片自动切换的判断（种子色只是一颗
 *   高饱和主色，用它的明暗判断整图会误判，例如黑底 + 高饱和亮色），以及算压在壁纸上的
 *   文字该用什么颜色。
 */
function extractSeedArgb(img) {
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return null;

    const scale = Math.min(1, SEED_IMAGE_MAX_SIZE / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法创建 canvas 上下文');
    ctx.drawImage(img, 0, 0, width, height);

    const data = ctx.getImageData(0, 0, width, height).data;
    const pixels = [];
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 255) continue; // 与原实现一致：只用完全不透明的像素
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        pixels.push(argbFromRgb(r, g, b));
        sumR += r;
        sumG += g;
        sumB += b;
        opaque += 1;
    }
    if (pixels.length === 0) return null;

    const ranked = Score.score(QuantizerCelebi.quantize(pixels, 128));
    if (!ranked.length) return null;

    // 平均色只算一次 HCT，比逐像素算 tone 便宜得多，判断明暗足够
    const averageRgb = argbFromRgb(sumR / opaque, sumG / opaque, sumB / opaque);
    return { argb: ranked[0], averageArgb: averageRgb, averageTone: Hct.fromInt(averageRgb).tone };
}

/** 把 hex / <img> / File / 图片地址统一加载成 <img> */
async function loadSourceImage(source) {
    if (source instanceof HTMLImageElement) return source;
    if (source instanceof File) {
        const url = URL.createObjectURL(source);
        try {
            return await loadImageElement(url);
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    if (typeof source === 'string' && source) {
        const src = normalizeImageSource(source);
        if (src) return await loadImageElement(src);
    }
    return null;
}

/**
 * 解析主题来源的种子色与“判断明暗用的 tone”。
 * - 直接给颜色（hex）时，用该颜色自身的 tone
 * - 给图片/图片地址时，用整张图平均色的 tone（见 extractSeedArgb），
 *   这样深色模式才是“跟着图片走”，而不是被某颗高饱和主色带偏
 * 取出的 hex 可以直接当种子交给 createScheme，不会改变配色结果。
 * @returns {Promise<{hex: string, tone: number}|null>}
 */
async function resolveSeed(source) {
    try {
        if (typeof source === 'string' && source.startsWith('#')) {
            const argb = argbFromHex(source);
            return { hex: hexFromArgb(argb), tone: Hct.fromInt(argb).tone };
        }
        const img = await loadSourceImage(source);
        if (!img) return null;
        const extracted = extractSeedArgb(img);
        if (!extracted) return null;
        // 记住壁纸平均色：既供薄纱/壁纸文字色使用，也让下次启动不必重新解码壁纸
        rememberWallpaperArgb(extracted.averageArgb);
        return { hex: hexFromArgb(extracted.argb), tone: extracted.averageTone };
    } catch (err) {
        console.warn('解析种子色失败，沿用上一次判断:', err);
        return null;
    }
}

// ==================== 壁纸可读性（薄纱 + 压在壁纸上的文字色） ====================
// 时钟/日期直接压在用户壁纸上，而配色方案只保证“方案背景色上的前景色”对比度。
// 两者不匹配时（深色方案 + 浅色壁纸，或反过来）要补救：
//   1) 深色方案下、壁纸明显比方案背景亮时铺一层薄纱压暗，让深色模式真的看着是深色；
//      壁纸本来就暗就不铺——深色压深色几乎看不出差别，没必要动用户壁纸
//   2) 压在壁纸上的文字颜色按“实际背景”（壁纸 + 薄纱）现算，方案 primary 达不到
//      大字号阈值就退到黑/白
// 壁纸本来就配得上当前方案时两件事都不做。
const WALLPAPER_TEXT_MIN_CONTRAST = 3; // 时钟 15vw、日期 1.8vw 都算大字号，AA 要求 3:1
const DARK_SCRIM_OPACITY = 0.68;
const DARK_SCRIM_TONE_GAP = 30; // 壁纸比方案背景亮这么多才值得压暗
const WALLPAPER_ARGB_STORAGE_KEY = 'materia_wallpaper_argb';

// 当前壁纸的平均色（ARGB）。取过一次就缓存，避免每次启动都重新解码整张壁纸
let wallpaperArgb = null;

function relativeLuminance(argb) {
    const channel = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel((argb >> 16) & 0xff)
        + 0.7152 * channel((argb >> 8) & 0xff)
        + 0.0722 * channel(argb & 0xff);
}

/** WCAG 对比度 */
function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
}

/** 把半透明的 over 压在不透明的 under 上 */
function compositeArgb(over, under, alpha) {
    const mix = (shift) => {
        const o = (over >> shift) & 0xff;
        const u = (under >> shift) & 0xff;
        return Math.round(o * alpha + u * (1 - alpha));
    };
    return (0xff << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

function rememberWallpaperArgb(argb) {
    wallpaperArgb = argb;
    try {
        localStorage.setItem(WALLPAPER_ARGB_STORAGE_KEY, String(argb));
    } catch {
        // 存不下就算了，下次启动重新取一次
    }
}

function restoreWallpaperArgb() {
    try {
        const value = Number(localStorage.getItem(WALLPAPER_ARGB_STORAGE_KEY));
        wallpaperArgb = Number.isFinite(value) && value !== 0 ? value : null;
    } catch {
        wallpaperArgb = null;
    }
}

function forgetWallpaperArgb() {
    wallpaperArgb = null;
    try {
        localStorage.removeItem(WALLPAPER_ARGB_STORAGE_KEY);
    } catch {
        // ignore
    }
}

function readSchemeColor(name) {
    const hex = normalizeSeedColor(getComputedStyle(ensureSPage()).getPropertyValue(name));
    return hex ? argbFromHex(hex) : null;
}

/**
 * 按当前方案与实际壁纸，决定薄纱厚度与压在壁纸上的文字颜色。
 * 每次应用主题、切换显示模式之后都要调用。
 * @returns {{scrimAlpha: number, textColor: string|null}}
 */
function syncWallpaperReadability() {
    const schemeBg = readSchemeColor('--s-color-background');
    const schemePrimary = readSchemeColor('--s-color-primary');

    // 1) 薄纱：只在深色方案下压暗偏亮的壁纸
    let scrimAlpha = 0;
    if (currentScheme() === 'dark' && wallpaperArgb != null && schemeBg != null) {
        const wallpaperTone = Hct.fromInt(wallpaperArgb).tone;
        const schemeBgTone = Hct.fromInt(schemeBg).tone;
        if (wallpaperTone > schemeBgTone + DARK_SCRIM_TONE_GAP) scrimAlpha = DARK_SCRIM_OPACITY;
    }
    const scrim = document.querySelector('.scrim');
    if (scrim) scrim.style.opacity = String(scrimAlpha);

    // 2) 压在壁纸上的文字：先用方案 primary，达不到阈值就按实际背景的明暗退到黑/白
    const effectiveBg = wallpaperArgb != null && schemeBg != null
        ? compositeArgb(schemeBg, wallpaperArgb, scrimAlpha)
        : schemeBg;
    let textColor = null;
    if (schemePrimary != null && effectiveBg != null) {
        textColor = contrastRatio(schemePrimary, effectiveBg) >= WALLPAPER_TEXT_MIN_CONTRAST
            ? hexFromArgb(schemePrimary)
            : (relativeLuminance(effectiveBg) < 0.5 ? '#ffffff' : '#000000');
    }
    if (textColor) {
        document.documentElement.style.setProperty('--on-wallpaper-color', textColor);
    }
    return { scrimAlpha, textColor };
}

/** 当前模式对应的 s-page theme 值 */
function resolvePageTheme() {
    if (themeMode === 'auto') return 'auto'; // 交给 s-page 自己跟随系统
    if (themeMode === 'light' || themeMode === 'dark') return themeMode;
    // 跟随取色：按种子色明暗决定
    if (lastSeedTone == null) return 'light';
    return lastSeedTone < DARK_SOURCE_TONE ? 'dark' : 'light';
}

/** 当前实际是深色还是浅色 */
function currentScheme() {
    const page = ensureSPage();
    return page.isDark ? 'dark' : 'light';
}

/**
 * 把当前模式应用到 s-page。
 * animated 且给出 trigger 时走 s-page 内置的 View Transitions 圆形揭示动画
 * （浏览器不支持时它自己会降级为直接切换）。
 */
async function applySchemeMode({ animated = false, trigger = null } = {}) {
    const page = ensureSPage();
    const target = resolvePageTheme();
    // s-page 的 toggle 在目标与当前相同时会返回一个永不 resolve 的 Promise，必须先挡掉
    if (page.theme !== target) {
        if (animated && typeof page.toggle === 'function') {
            await page.toggle(target, trigger || undefined);
        } else {
            page.theme = target;
        }
    }
    // 即使明暗没变，重新取色也会换掉整套配色，壁纸可读性同样要重算
    syncWallpaperReadability();
    return target;
}

/** 菜单里的对勾与按钮提示 */
function syncThemeModeMenu() {
    THEME_MODES.forEach((mode) => {
        const item = document.getElementById(`theme-mode-${mode}`);
        const label = item?.querySelector('.theme-mode-label');
        if (!label) return;
        const text = THEME_MODE_LABELS[mode];
        label.textContent = mode === themeMode ? `✓ ${text}` : text;
    });
    const trigger = document.getElementById('theme-mode-btn');
    if (trigger) trigger.dataset.name = `显示模式：${THEME_MODE_LABELS[themeMode]}`;
}

/**
 * 纠正 s-page 残留的系统主题监听。
 * sober 的 s-page 只在 theme='auto' 时挂 prefers-color-scheme 监听，切回 light/dark
 * 时并不会摘掉它，于是系统主题一变就会把用户明确选的固定模式覆盖掉。
 * 这里在收到它的 change 事件时把模式纠正回来。返回是否发生了纠正。
 */
function reconcileSchemeMode() {
    if (themeMode === 'auto') return false; // auto 模式下这正是预期的跟随行为
    const page = ensureSPage();
    const expected = resolvePageTheme();
    if (page.theme === expected) return false;
    page.theme = expected;
    return true;
}

/**
 * 切换显示模式。
 * @param {string} mode color / auto / light / dark
 * @param {{trigger?: HTMLElement|null, persist?: boolean}} [options]
 */
async function setThemeMode(mode, { trigger = null, persist = true } = {}) {
    themeMode = normalizeThemeMode(mode);
    if (persist) localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
    syncThemeModeMenu();
    await applySchemeMode({ animated: Boolean(trigger), trigger });
    syncThemeToIframeBackground();
    return themeMode;
}

// ==================== 重新取色过渡 ====================
const THEME_TRANSITION_CLASS = 'theme-transition';
const THEME_TRANSITION_MS = 520;
let themeTransitionTimer = null;

/**
 * 重新取色时套一层过渡动画。
 * createScheme 会一次性替换 s-page 的 inline style，所有 var(--s-color-*) 同时改变，
 * 默认是瞬变。这里在换色前给 <html> 挂上 theme-transition（见 index.html 的同名规则），
 * 换色完成、过渡走完后再摘掉，避免长期覆盖 hover、拖拽等自身过渡。
 * 首次加载不走这里（loading-modal 还盖着，动画没意义）。
 */
async function applyThemeAnimated(source) {
    // 先解析种子色：既能省掉再解一次图片，也用于“跟随取色”判断明暗
    const seed = await resolveSeed(source);
    if (seed) lastSeedTone = seed.tone;
    const applySource = seed ? seed.hex : source;

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReduced) {
        await applyMaterialYouTheme(applySource);
        await applySchemeMode({ animated: false });
        syncThemeToIframeBackground();
        return;
    }

    const root = document.documentElement;
    root.classList.add(THEME_TRANSITION_CLASS);
    // 强制一次样式计算，确保过渡规则在颜色改变之前已经生效
    void root.offsetWidth;

    clearTimeout(themeTransitionTimer);
    try {
        await applyMaterialYouTheme(applySource);
        // 明暗也要在过渡类还挂着的时候切，这样换配色和换明暗是同一次平滑过渡
        await applySchemeMode({ animated: false });
        syncThemeToIframeBackground();
    } finally {
        themeTransitionTimer = setTimeout(() => {
            root.classList.remove(THEME_TRANSITION_CLASS);
        }, THEME_TRANSITION_MS + 80);
    }
}

// ==================== 图片操作 ====================
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

// 站内默认壁纸（index.html 里 body 的 background-image 用的就是它）。
// 没有自定义背景图时按它取色，这样「清除图片」恢复默认壁纸后配色会重新跟着默认壁纸走，
// 而不是停在一个写死的颜色上。
const DEFAULT_WALLPAPER = './assets/default.png';

async function loadImages() {
    // 1. 加载背景图片文件（如果有）
    const bgFile = await getDB('background_img');
    
    // 2. 处理主题生成（优先使用缓存主色，其次自定义背景图，最后默认壁纸）
    //    壁纸平均色也先恢复：主题若来自缓存 hex 就不会再解码壁纸，
    //    但薄纱与时钟颜色仍然需要知道壁纸的明暗
    restoreWallpaperArgb();
    const cachedColor = getCachedPrimaryColor();
    const initialSource = cachedColor || bgFile || DEFAULT_WALLPAPER;

    // 首屏也要定好明暗（跟随取色模式下靠种子色的 tone 判断），
    // 但不走圆形揭示动画：loading-modal 还盖着，而且这是首次绘制
    const seed = await resolveSeed(initialSource);
    if (seed) lastSeedTone = seed.tone;
    await applyMaterialYouTheme(seed ? seed.hex : initialSource);
    await applySchemeMode({ animated: false });
    
    // 3. 应用背景图片（必须在主题之后，避免覆盖样式）
    if (bgFile) {
        const url = URL.createObjectURL(bgFile);
        applyBackgroundImage(url);
    }
    
    // 4. 加载自定义图片库
    savedCustomImages = (await getDB('custom_images')) || [];
    savedCustomImages.forEach(imgData => createCustomImgElement(imgData.id, imgData.file));
}

// 「更换背景」菜单 -> 选择本地图片
document.getElementById('bg-image-item').addEventListener('click', () => {
    const input = document.getElementById('bg-input');
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            applyBackgroundImage(url, true);
            await setDB('background_img', file);
            // 重新从图片提取主色并自动缓存（带过渡）
            await applyThemeAnimated(file);
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

// ==================== iframe 背景 ====================
// 允许把任意网页作为看板背景（background iframe），并提供消息 SDK：
// 背景页引入 /iframe-bg-sdk.js 后调用 MateriaBackground.repick('#RRGGBB') 即可让看板重新取色。
const IFRAME_BG_STORAGE_KEY = 'materia_iframe_bg';
const IFRAME_BG_CHANNEL = 'materia-homework-iframe-bg';
const IFRAME_BG_HOST_SOURCE = 'materia-homework-host';
let currentIframeUrl = '';
let iframeBgLayer = null;

// 允许 http(s) 绝对地址、// 开头、/ 或 ./ 开头的站内路径；裸域名自动补 https://
function normalizeIframeUrl(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    let candidate = text;
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(candidate);
    if (!hasScheme && !candidate.startsWith('//')) {
        const isPathLike = candidate.startsWith('/') || candidate.startsWith('./') || candidate.startsWith('../');
        if (!isPathLike) candidate = `https://${candidate}`;
    }
    try {
        const parsed = new URL(candidate, location.href);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        return parsed.href;
    } catch (err) {
        return '';
    }
}

function isValidHexColor(value) {
    return typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim());
}

/** 把 '#abc' / '#aabbcc' / 'rgb(1,2,3)' 归一化成 '#rrggbb'，无法解析时返回 '' */
function normalizeSeedColor(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (!text) return '';
    if (isValidHexColor(text)) {
        if (text.length === 4) {
            return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
        }
        return text.slice(0, 7).toLowerCase();
    }
    const match = text.match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i);
    if (!match) return '';
    const toByte = (n) => Math.max(0, Math.min(255, parseInt(n, 10)));
    return `#${[match[1], match[2], match[3]].map((n) => toByte(n).toString(16).padStart(2, '0')).join('')}`;
}

function getIframeBgFrame() {
    return iframeBgLayer ? iframeBgLayer.querySelector('iframe') : null;
}

function ensureIframeBgLayer() {
    if (iframeBgLayer && iframeBgLayer.isConnected) return iframeBgLayer;

    const layer = document.createElement('div');
    layer.className = 'iframe-bg-layer';
    layer.setAttribute('aria-hidden', 'true');

    const frame = document.createElement('iframe');
    frame.className = 'iframe-bg-frame';
    frame.title = '动态背景';
    frame.setAttribute('loading', 'eager');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', 'autoplay; fullscreen');
    // 背景页运行在沙箱里；allow-same-origin 只为让同源背景页能正常读写自身资源
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-pointer-lock');
    frame.addEventListener('load', () => syncThemeToIframeBackground());

    layer.appendChild(frame);
    const page = ensureSPage();
    page.insertBefore(layer, page.firstChild);
    iframeBgLayer = layer;
    return layer;
}

/** 应用 iframe 背景；url 非法时返回 false */
function applyIframeBackground(rawUrl, { persist = true } = {}) {
    const url = normalizeIframeUrl(rawUrl);
    if (!url) return false;

    const layer = ensureIframeBgLayer();
    const frame = getIframeBgFrame();
    if (frame && frame.getAttribute('src') !== url) {
        frame.setAttribute('src', url);
    }
    layer.hidden = false;
    currentIframeUrl = url;
    if (persist) localStorage.setItem(IFRAME_BG_STORAGE_KEY, url);
    syncThemeToIframeBackground();
    return true;
}

function clearIframeBackground({ persist = true } = {}) {
    currentIframeUrl = '';
    const frame = getIframeBgFrame();
    if (frame) frame.removeAttribute('src');
    if (iframeBgLayer) {
        iframeBgLayer.remove();
        iframeBgLayer = null;
    }
    if (persist) localStorage.removeItem(IFRAME_BG_STORAGE_KEY);
}

function restoreIframeBackground() {
    const saved = localStorage.getItem(IFRAME_BG_STORAGE_KEY);
    if (saved && applyIframeBackground(saved, { persist: false })) return true;
    if (saved) localStorage.removeItem(IFRAME_BG_STORAGE_KEY);
    return false;
}

/** 把当前主题主色与明暗广播给背景 iframe，便于背景页跟随配色 */
function syncThemeToIframeBackground() {
    const frame = getIframeBgFrame();
    if (!frame || !frame.contentWindow) return;
    const color = getPrimaryColorFromPage() || getCachedPrimaryColor() || '';
    try {
        frame.contentWindow.postMessage(
            {
                channel: IFRAME_BG_CHANNEL,
                source: IFRAME_BG_HOST_SOURCE,
                type: 'theme',
                color: color,
                seed: color,
                scheme: currentScheme(),
                mode: themeMode,
            },
            '*',
        );
    } catch (err) {
        console.warn('向 iframe 背景广播主题失败:', err);
    }
}

/**
 * 重新取色（color-repick）。
 * 传入颜色时以该颜色为种子重建主题；未传时用看板自身背景图 / 缓存主色重新取色。
 */
async function repickColor(seedColor) {
    const color = normalizeSeedColor(seedColor);

    if (color) {
        await applyThemeAnimated(color);
    } else {
        const bgFile = await getDB('background_img');
        if (bgFile) {
            await applyThemeAnimated(bgFile);
        } else {
            // 没有自定义背景图时，背景就是站内默认壁纸，按它重新取色
            await applyThemeAnimated(DEFAULT_WALLPAPER);
        }
    }
    if (typeof window.recomputeScale === 'function') window.recomputeScale();
    return getPrimaryColorFromPage();
}

// ---------- 直接给图片取色（供 iframe SDK 调用） ----------

/** 校验并归一化图片地址：支持 http(s)、data:image、blob: 以及站内相对路径 */
function normalizeImageSource(raw) {
    if (raw == null) return '';
    const text = String(raw).trim();
    if (!text) return '';
    if (/^data:image\//i.test(text)) return text;
    if (/^blob:/i.test(text)) return text;
    return normalizeIframeUrl(text);
}

function loadImageElement(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        // 跨域图片需要 CORS 才能读取像素；不带 CORS 头时会加载失败，直接如实报错
        let crossOrigin = false;
        try {
            crossOrigin = new URL(src, location.href).origin !== location.origin;
        } catch {
            crossOrigin = false;
        }
        if (crossOrigin) img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(crossOrigin ? '图片加载失败（跨域图片需要允许 CORS）' : '图片加载失败'));
        img.src = src;
    });
}

/**
 * 用图片本身取色并应用主题。
 * @returns {Promise<string>} 取到的 '#rrggbb'
 */
async function repickFromImageSource(rawSrc) {
    const src = normalizeImageSource(rawSrc);
    if (!src) throw new Error('图片地址无效');
    const img = await loadImageElement(src);
    const extracted = extractSeedArgb(img);
    if (!extracted) throw new Error('图片中没有可用的像素');
    const color = hexFromArgb(extracted.argb);
    await applyThemeAnimated(color);
    if (typeof window.recomputeScale === 'function') window.recomputeScale();
    return color;
}

/** 向背景 iframe 回发消息 */
function replyToIframeBackground(payload) {
    const frame = getIframeBgFrame();
    if (!frame || !frame.contentWindow) return;
    try {
        frame.contentWindow.postMessage(
            { channel: IFRAME_BG_CHANNEL, source: IFRAME_BG_HOST_SOURCE, ...payload },
            '*',
        );
    } catch (err) {
        console.warn('向 iframe 背景回发消息失败:', err);
    }
}

window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== IFRAME_BG_CHANNEL) return;
    if (data.source === IFRAME_BG_HOST_SOURCE) return;

    // 只接受当前背景 iframe 发来的消息，避免其它 iframe 误触发
    const frame = getIframeBgFrame();
    if (frame && frame.contentWindow && event.source && event.source !== frame.contentWindow) return;

    try {
        if (data.type === 'color-repick') {
            await repickColor(data.color);
        } else if (data.type === 'color-set') {
            if (isValidHexColor(data.color)) await repickColor(data.color.trim());
        } else if (data.type === 'color-repick-image') {
            try {
                const color = await repickFromImageSource(data.src);
                replyToIframeBackground({ type: 'color-pick-result', requestId: data.requestId, ok: true, color });
            } catch (err) {
                replyToIframeBackground({
                    type: 'color-pick-result',
                    requestId: data.requestId,
                    ok: false,
                    error: String(err?.message || err),
                });
            }
        } else if (data.type === 'set-scheme') {
            // 背景页可以请求切换显示模式（不写回本地偏好，刷新后回到用户自己的设置）
            if (THEME_MODES.includes(data.mode)) {
                await setThemeMode(data.mode, { persist: false });
            }
        } else if (data.type === 'ready') {
            syncThemeToIframeBackground();
        }
    } catch (err) {
        console.warn('处理 iframe 背景消息失败:', err);
    }
});

// ==================== 时钟 ====================
function updateClock() {
    const now = new Date();
    document.getElementById('hours').textContent = String(now.getHours()).padStart(2, '0');
    document.getElementById('minutes').textContent = String(now.getMinutes()).padStart(2, '0');
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    document.getElementById('date').textContent = `${days[now.getDay()]}, ${now.getMonth() + 1}月${now.getDate()}日`;
}

// ==================== 截图导出 ====================
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
        // html2canvas 无法绘制 iframe 内容，导出时先隐藏背景层
        document.body.classList.add('capturing');
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
        link.download = `作业_${dayjs().format('YYYY-MM-DD_HHmmss')}.png`;
        link.href = imgData;
        link.click();
    } catch (err) {
        console.error('截图失败:', err);
    } finally {
        document.body.classList.remove('capturing');
        const controls = document.querySelector('.controls');
        const restorePanel = document.getElementById('restore-panel');
        if (controls) controls.style.display = '';
        if (restorePanel) restorePanel.style.display = '';
        const tempStyle = document.getElementById('temp-disable-transitions');
        if (tempStyle) tempStyle.remove();
    }
});

// ==================== 自适应缩放 ====================
let scaleRafId = 0;
let scalePanel = null;

const MIN_TASK_SCALE = 0.55;
// 二分收敛精度。每次迭代都要 getBoundingClientRect() 强制一次同步布局，而 0.2%
// 的缩放差肉眼完全看不出来，0.01（1%）在效果不变的前提下少两次强制重排。
const SCALE_EPSILON = 0.01;

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

    // 二分找“装得下的最大缩放”。这里的迭代次数直接等于强制同步布局的次数，
    // 在内容多、屏幕分辨率高、GPU 弱的设备上是掉帧来源，所以精度只取到 SCALE_EPSILON。
    let lo = MIN_TASK_SCALE;
    let hi = 1;
    while (hi - lo > SCALE_EPSILON) {
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

// ==================== Service Worker（PWA 离线支持） ====================
// 使用 vite-plugin-pwa 提供的注册器：生产环境注册 precache + 离线导航回退的 SW，
// 开发环境注册 dev-sw，避免手动写死 /sw.js 在 dev 下 404。
registerSW({ immediate: true });

// ==================== 初始化 ====================
setInterval(updateClock, 1000);
updateClock();

window.resetContent = function() {
    // 保留科目配置（名称/图标/排序/隐藏状态等），仅清空内容
    if (!Array.isArray(appState) || appState.length === 0) {
        try {
            const saved = localStorage.getItem('kanban_data');
            const parsed = saved ? JSON.parse(saved) : null;
            if (Array.isArray(parsed)) {
                appState.length = 0;
                appState.push(...parsed);
            }
        } catch {
            // ignore
        }
    }
    if (Array.isArray(appState)) {
        appState.forEach(s => {
            s.content = '';
        });
        saveState();
        renderUI();
    }

    const dialog = document.getElementById('reset-content-dialog');
    if (dialog) dialog.showed = false;
};

window.resetPic = function() {
    indexedDB.deleteDatabase('KanbanDB');
    localStorage.removeItem(PRIMARY_COLOR_CACHE_KEY);  // 同时清除主色缓存
    localStorage.removeItem(IFRAME_BG_STORAGE_KEY);    // 同时清除 iframe 背景
    forgetWallpaperArgb();                            // 壁纸平均色也要清，下次按默认壁纸重新取
    location.reload();
};

(async () => {

    // 先恢复用户上次选的显示模式，首屏就按它渲染，避免亮→暗闪一下
    themeMode = normalizeThemeMode(localStorage.getItem(THEME_MODE_STORAGE_KEY));

    await initData();
    await loadImages();
    // 恢复 iframe 背景（主题已就绪，随后会广播给背景页）
    restoreIframeBackground();
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

    // 仅在“本地已有使用记录且版本号变化”时弹一次 changelog
    await maybeShowChangelogOnce();
    
    // ==================== 科目管理事件监听 ====================
    // 打开科目管理对话框
    const manageSubjectMenuBtn = document.getElementById('manage-subject-btn');
    if (manageSubjectMenuBtn) {
        manageSubjectMenuBtn.addEventListener('click', async () => {
            await openSubjectManageDialog();
        });
    }
    
    // 关闭科目管理对话框
    const closeManageBtn = document.getElementById('subject-manage-close');
    if (closeManageBtn) {
        closeManageBtn.addEventListener('click', () => {
            const dialog = document.getElementById('subject-manage-dialog');
            if (dialog) dialog.showed = false;
        });
    }
    
    // 打开添加科目对话框
    const addSubjectBtn = document.getElementById('add-subject-btn');
    if (addSubjectBtn) {
        addSubjectBtn.addEventListener('click', openAddSubjectDialog);
    }
    
    // 添加科目对话框事件
    const addSubjectConfirm = document.getElementById('add-subject-confirm');
    const addSubjectCancel = document.getElementById('add-subject-cancel');
    
    if (addSubjectCancel) {
        addSubjectCancel.addEventListener('click', () => {
            const dialog = document.getElementById('add-subject-dialog');
            if (dialog) dialog.showed = false;
        });
    }
    
    if (addSubjectConfirm) {
        addSubjectConfirm.addEventListener('click', () => {
            const nameInput = document.getElementById('new-subject-name');
            const iconPicker = document.getElementById('new-subject-icon');
            
            const name = nameInput?.value?.trim();
            const icon = iconPicker?.value;
            
            if (!name) {
                alert('请输入科目名称');
                return;
            }
            
            const newId = 'subject_' + Date.now();
            appState.push({
                id: newId,
                name: name,
                icon: icon || '',
                content: '',
                isDeleted: false
            });
            
            saveState();
            renderUI();
            renderSubjectManageDialog();
            
            // 清空输入
            if (nameInput) nameInput.value = '';
            if (iconPicker) iconPicker.value = '';
            
            const dialog = document.getElementById('add-subject-dialog');
            if (dialog) dialog.showed = false;
        });
    }

    // ==================== 显示模式事件监听 ====================
    syncThemeModeMenu();
    // s-page 只在 auto 下派发 change；固定模式下收到它说明是残留监听在覆盖，纠正回来
    ensureSPage().addEventListener('change', reconcileSchemeMode);
    THEME_MODES.forEach((mode) => {
        const item = document.getElementById(`theme-mode-${mode}`);
        if (!item) return;
        item.addEventListener('click', () => {
            // 用菜单项本身作为圆形揭示动画的起点
            setThemeMode(mode, { trigger: item });
        });
    });

    // ==================== iframe 背景事件监听 ====================
    const iframeBgDialog = document.getElementById('iframe-bg-dialog');
    const iframeBgUrlInput = document.getElementById('iframe-bg-url');

    // 「更换背景」菜单 -> 使用 iframe 网页
    const iframeBgBtn = document.getElementById('bg-iframe-item');
    if (iframeBgBtn) {
        iframeBgBtn.addEventListener('click', () => {
            if (!iframeBgDialog) return;
            if (iframeBgUrlInput) iframeBgUrlInput.value = currentIframeUrl || '';
            iframeBgDialog.showed = true;
        });
    }

    const iframeBgCancel = document.getElementById('iframe-bg-cancel');
    if (iframeBgCancel) {
        iframeBgCancel.addEventListener('click', () => {
            if (iframeBgDialog) iframeBgDialog.showed = false;
        });
    }

    const iframeBgClear = document.getElementById('iframe-bg-clear');
    if (iframeBgClear) {
        iframeBgClear.addEventListener('click', () => {
            clearIframeBackground();
            if (iframeBgUrlInput) iframeBgUrlInput.value = '';
            if (iframeBgDialog) iframeBgDialog.showed = false;
        });
    }

    const iframeBgConfirm = document.getElementById('iframe-bg-confirm');
    if (iframeBgConfirm) {
        iframeBgConfirm.addEventListener('click', () => {
            const raw = iframeBgUrlInput?.value?.trim() || '';
            if (!raw) {
                clearIframeBackground();
                if (iframeBgDialog) iframeBgDialog.showed = false;
                return;
            }
            if (!applyIframeBackground(raw)) {
                Dialog.builder({
                    headline: '提示',
                    text: '无法识别这个地址，请填写 https:// 开头的网址，或以 / 、./ 开头的站内路径。',
                    actions: [{ text: '知道了' }],
                });
                return;
            }
            if (iframeBgDialog) iframeBgDialog.showed = false;
        });
    }

    // 弹窗里一键填入内置示例页
    const iframeBgDemo = document.getElementById('iframe-bg-demo');
    if (iframeBgDemo) {
        iframeBgDemo.addEventListener('click', () => {
            if (iframeBgUrlInput) iframeBgUrlInput.value = './iframe-bg-demo.html';
        });
    }

    initRichEditorDialog();
})();

document.getElementById('full-screen-btn').addEventListener('click', () => {
    if (screenfull.isEnabled) screenfull.toggle();
});

let currentEditId = null;
const richTextEditor = createRichTextEditor({
  appState,
  getCurrentEditId: () => currentEditId,
  setCurrentEditId: (id) => {
    currentEditId = id;
  },
  saveState,
  renderUI,
});

const initRichEditorDialog = richTextEditor.initRichEditorDialog;
const openEditDialog = richTextEditor.openEditDialog;
