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

export function createRichTextEditor({
  appState,
  getCurrentEditId,
  setCurrentEditId,
  saveState,
  renderUI,
}) {
  let editDialog = null;
  let quill = null;
  let originalHtml = '';
  let draftHtml = '';
  let draftSyncRafId = null;

  const closeEditorDialog = () => {
    if (!editDialog) return;
    setCurrentEditId(null);
    editDialog.showed = false;
    renderUI();
  };

  const handleConfirm = () => {
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
