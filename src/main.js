// ==================== 导入依赖 ====================
import screenfull from 'screenfull';
import html2canvas from 'html2canvas';
import 'sober';
import { createScheme } from 'sober-theme';
import { createRichTextEditor } from './richTextEditor';
import changelogText from '../CHANGELOG.txt?raw';

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

        const clearIndicators = () => {
            document.querySelectorAll('.subject-manage-item').forEach(el => {
                el.style.borderTop = '';
                el.style.borderBottom = '';
            });
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

            clearIndicators();
            const rect = overEl.getBoundingClientRect();
            const insertAfter = ev.clientY > rect.top + rect.height / 2;
            if (insertAfter) overEl.style.borderBottom = '2px solid var(--s-color-primary, #FFA3B1)';
            else overEl.style.borderTop = '2px solid var(--s-color-primary, #FFA3B1)';
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

// ==================== 自适应缩放 ====================
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

// ==================== Service Worker ====================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('Service Worker 注册成功:', registration.scope))
            .catch(error => console.log('Service Worker 注册失败:', error));
    });
}

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
    location.reload();
};

(async () => {

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
