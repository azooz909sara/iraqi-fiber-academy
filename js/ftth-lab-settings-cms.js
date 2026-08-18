/**
 * Admin settings modal for FTTH Lab toolbox icons (admin preview only).
 */
(function () {
  'use strict';

  var modalOpen = false;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function store() { return window.FtthLabSettings; }

  function isAdminPreviewContext() {
    try {
      if (window.self !== window.top) return true;
    } catch (err) {
      return true;
    }
    try {
      return new URLSearchParams(window.location.search).get('mode') === 'admin-preview';
    } catch (err2) {
      return false;
    }
  }

  function setStatus(msg, isError) {
    var el = $('ftth-lab-settings-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
  }

  function syncToolbar() {
    var s = store();
    if (!s) return;
    var undo = $('ftth-lab-settings-undo');
    var redo = $('ftth-lab-settings-redo');
    if (undo) undo.disabled = !s.canUndo();
    if (redo) redo.disabled = !s.canRedo();
  }

  function renderBody() {
    var host = $('ftth-lab-settings-body');
    if (!host || !store()) return;
    var draft = store().getDraft();
    var html = '';
    draft.categories.forEach(function (cat) {
      var items = draft.items.filter(function (it) { return it.categoryId === cat.id; });
      if (!items.length) return;
      html += '<section class="lab-settings-cms__section">' +
        '<h3 class="lab-settings-cms__cat">' + escapeHtml(cat.label) + '</h3>';
      items.forEach(function (item) {
        var previewClass = 'lab-tool__mark' + (item.markClass ? ' lab-tool__mark--' + item.markClass : '');
        var previewStyle = '';
        if (item.icon && item.icon.indexOf('data:image') === 0) {
          previewStyle = ' style="background-image:url(\'' + item.icon.replace(/'/g, '%27') + '\');background-size:contain;background-repeat:no-repeat;background-position:center;background-color:transparent;border-color:rgba(148,163,184,0.25);"';
        }
        html +=
          '<div class="lab-settings-cms__row" data-lab-icon-row="' + escapeHtml(item.toolKey) + '">' +
            '<div class="lab-settings-cms__preview" aria-hidden="true">' +
              '<span class="' + previewClass + ' lab-settings-cms__mark"' + previewStyle + '></span>' +
            '</div>' +
            '<div class="lab-settings-cms__meta">' +
              '<strong>' + escapeHtml(item.label) + '</strong>' +
              '<span>' + escapeHtml(item.sublabel) + '</span>' +
            '</div>' +
            '<div class="lab-settings-cms__actions">' +
              '<label class="lab-settings-cms__upload">' +
                'Upload icon' +
                '<input type="file" accept="image/png, image/svg+xml, image/jpeg" ' +
                  'data-lab-icon-upload="' + escapeHtml(item.toolKey) + '">' +
              '</label>' +
              '<button type="button" class="lab-settings-cms__btn lab-settings-cms__btn--ghost" ' +
                'data-lab-icon-clear="' + escapeHtml(item.toolKey) + '"' +
                (item.icon ? '' : ' disabled') + '>Clear</button>' +
            '</div>' +
          '</div>';
      });
      html += '</section>';
    });
    host.innerHTML = html;
    syncToolbar();
  }

  function ensureModal() {
    if ($('ftth-lab-settings-modal')) return;
    var wrap = document.createElement('div');
    wrap.id = 'ftth-lab-settings-modal';
    wrap.className = 'lab-settings-cms';
    wrap.hidden = true;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'ftth-lab-settings-title');
    wrap.innerHTML =
      '<div class="lab-settings-cms__backdrop" data-lab-settings-close></div>' +
      '<div class="lab-settings-cms__panel">' +
        '<header class="lab-settings-cms__header">' +
          '<div>' +
            '<h2 id="ftth-lab-settings-title">إعدادات مختبر FTTH</h2>' +
            '<p>Toolbox icons · saved in this browser (<code>ifa_ftth_lab_config</code>)</p>' +
          '</div>' +
          '<div class="lab-settings-cms__toolbar">' +
            '<button type="button" class="lab-settings-cms__btn" id="ftth-lab-settings-undo" title="Ctrl+Z">Undo</button>' +
            '<button type="button" class="lab-settings-cms__btn" id="ftth-lab-settings-redo" title="Ctrl+Y">Redo</button>' +
            '<button type="button" class="lab-settings-cms__btn lab-settings-cms__btn--warn" id="ftth-lab-settings-reset">Reset to Defaults</button>' +
            '<button type="button" class="lab-settings-cms__btn lab-settings-cms__btn--primary" id="ftth-lab-settings-save">Save Changes</button>' +
            '<button type="button" class="lab-settings-cms__btn" data-lab-settings-close>إغلاق</button>' +
          '</div>' +
        '</header>' +
        '<div class="lab-settings-cms__body" id="ftth-lab-settings-body"></div>' +
        '<p class="lab-settings-cms__status" id="ftth-lab-settings-status"></p>' +
      '</div>';
    document.body.appendChild(wrap);
    bindModal(wrap);
  }

  function refresh() {
    renderBody();
    syncToolbar();
  }

  function bindModal(root) {
    root.querySelectorAll('[data-lab-settings-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });

    root.addEventListener('change', function (e) {
      var input = e.target;
      if (!input || !input.getAttribute || !input.getAttribute('data-lab-icon-upload')) return;
      var toolKey = input.getAttribute('data-lab-icon-upload');
      var file = input.files && input.files[0];
      input.value = '';
      if (!file || !store()) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data = String(reader.result || '');
        if (data.indexOf('data:image') !== 0) {
          setStatus('Please upload PNG, JPEG, or SVG.', true);
          return;
        }
        if (data.length > store().MAX_ICON_CHARS) {
          setStatus('Icon file is too large for browser storage.', true);
          return;
        }
        store().setToolIcon(toolKey, data, true);
        setStatus('Icon updated · Save Changes to persist.');
        refresh();
      };
      reader.readAsDataURL(file);
    });

    root.addEventListener('click', function (e) {
      var clearBtn = e.target.closest ? e.target.closest('[data-lab-icon-clear]') : null;
      if (!clearBtn || !store()) return;
      var toolKey = clearBtn.getAttribute('data-lab-icon-clear');
      store().setToolIcon(toolKey, '', true);
      setStatus('Icon cleared · Save Changes to persist.');
      refresh();
    });

    $('ftth-lab-settings-undo').addEventListener('click', function () {
      if (store().undo()) {
        setStatus('Undo');
        refresh();
      }
    });
    $('ftth-lab-settings-redo').addEventListener('click', function () {
      if (store().redo()) {
        setStatus('Redo');
        refresh();
      }
    });
    $('ftth-lab-settings-reset').addEventListener('click', function () {
      if (window.confirm('Reset all FTTH Lab toolbox icons to factory defaults?')) {
        store().resetToDefaults();
        setStatus('Draft reset to factory defaults. Click Save Changes to apply.');
        refresh();
      }
    });
    $('ftth-lab-settings-save').addEventListener('click', function () {
      var ok = store().saveChanges();
      setStatus(ok ? 'Saved · toolbox icons updated.' : 'Save failed (storage quota).', !ok);
      syncToolbar();
    });
  }

  function openModal() {
    if (!isAdminPreviewContext() || !store()) return;
    ensureModal();
    modalOpen = true;
    var modal = $('ftth-lab-settings-modal');
    modal.hidden = false;
    store().discardDraft();
    refresh();
    setStatus('');
  }

  function closeModal() {
    modalOpen = false;
    var modal = $('ftth-lab-settings-modal');
    if (modal) modal.hidden = true;
    if (store()) store().discardDraft();
  }

  function onKey(e) {
    if (!modalOpen) return;
    e.stopPropagation();
    var key = (e.key || '').toLowerCase();
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) {
      if (key === 'escape') closeModal();
      return;
    }
    if (key === 'z' && e.shiftKey) {
      e.preventDefault();
      if (store().redo()) refresh();
      return;
    }
    if (key === 'z') {
      e.preventDefault();
      if (store().undo()) refresh();
      return;
    }
    if (key === 'y') {
      e.preventDefault();
      if (store().redo()) refresh();
    }
  }

  function bind() {
    var btn = $('ftth-lab-admin-settings-btn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
      });
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('ifa:ftth-lab-draft-changed', function () {
      if (modalOpen) refresh();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.FtthLabSettingsCms = {
    openModal: openModal,
    closeModal: closeModal,
    isAdminPreviewContext: isAdminPreviewContext,
  };
})();
