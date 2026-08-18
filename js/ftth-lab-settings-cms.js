/**
 * Admin settings modal for FTTH Lab toolbox icons + device metadata (admin preview only).
 */
(function () {
  'use strict';

  var modalOpen = false;
  var activeTab = 'devices';
  var selectedSfpVariantId = null;
  var cms = {
    storeName: 'FtthLabSettings',
    buttonId: 'ftth-lab-admin-settings-btn',
    modalId: 'ftth-lab-settings-modal',
    titleId: 'ftth-lab-settings-title',
    bodyId: 'ftth-lab-settings-body',
    statusId: 'ftth-lab-settings-status',
    undoId: 'ftth-lab-settings-undo',
    redoId: 'ftth-lab-settings-redo',
    resetId: 'ftth-lab-settings-reset',
    saveId: 'ftth-lab-settings-save',
    title: 'إعدادات مختبر FTTH',
    subtitle: 'Device names, specs, toolbox icons · <code>ifa_ftth_lab_config</code>',
    resetConfirm: 'Reset all FTTH Lab device settings to factory defaults?',
  };

  function useOpmCms() {
    cms = {
      storeName: 'OpmSettings',
      buttonId: 'opm-admin-settings-btn',
      modalId: 'opm-settings-modal',
      titleId: 'opm-settings-title',
      bodyId: 'opm-settings-body',
      statusId: 'opm-settings-status',
      undoId: 'opm-settings-undo',
      redoId: 'opm-settings-redo',
      resetId: 'opm-settings-reset',
      saveId: 'opm-settings-save',
      title: 'إعدادات قياس القدرة البصرية',
      subtitle: 'Device names, specs, toolbox icons · <code>ifa_opm_config</code>',
      resetConfirm: 'Reset all Optical Power Meter device settings to factory defaults?',
    };
  }

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function store() { return window[cms.storeName]; }

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
    var el = $(cms.statusId);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
  }

  function syncToolbar() {
    var s = store();
    if (!s) return;
    var undo = $(cms.undoId);
    var redo = $(cms.redoId);
    if (undo) undo.disabled = !s.canUndo();
    if (redo) redo.disabled = !s.canRedo();
  }

  function renderSpecsFields(item) {
    var html = '';
    if (item.toolKey === 'ols' || item.toolKey === 'sfp') {
      var levels = (item.specs && item.specs.txLevels) ? item.specs.txLevels.join(', ') : '-3, -6';
      var defTx = (item.specs && item.specs.defaultTxDbm != null) ? item.specs.defaultTxDbm : -3;
      html +=
        '<div class="lab-settings-cms__specs">' +
          '<p class="lab-settings-cms__specs-title">TX output levels (dBm)</p>' +
          '<label class="lab-settings-cms__field">' +
            '<span>Available levels (comma-separated)</span>' +
            '<input type="text" value="' + escapeAttr(levels) + '" ' +
              'data-lab-spec="txLevels" data-tool-key="' + escapeAttr(item.toolKey) + '">' +
          '</label>' +
          '<label class="lab-settings-cms__field">' +
            '<span>Default TX level (dBm)</span>' +
            '<input type="number" step="0.1" value="' + escapeAttr(String(defTx)) + '" ' +
              'data-lab-spec="defaultTxDbm" data-tool-key="' + escapeAttr(item.toolKey) + '">' +
          '</label>' +
        '</div>';
    }
    if (item.toolKey === 'splitter') {
      var losses = (item.specs && item.specs.losses) ? item.specs.losses : store().DEFAULT_SPLITTER_LOSSES;
      html += '<div class="lab-settings-cms__specs"><p class="lab-settings-cms__specs-title">Nominal insertion loss (dB)</p><div class="lab-settings-cms__loss-grid">';
      Object.keys(store().DEFAULT_SPLITTER_LOSSES).forEach(function (ratio) {
        html +=
          '<label class="lab-settings-cms__field lab-settings-cms__field--inline">' +
            '<span>' + escapeHtml(ratio.replace('x', ':')) + '</span>' +
            '<input type="number" step="0.1" min="0" value="' + escapeAttr(String(losses[ratio] != null ? losses[ratio] : '')) + '" ' +
              'data-lab-spec-loss="' + escapeAttr(ratio) + '" data-tool-key="splitter">' +
          '</label>';
      });
      html += '</div></div>';
    }
    return html;
  }

  function renderPerformanceFields(toolKey, ps, label) {
    ps = ps || {};
    var range = ps.powerRangeDbm || {};
    var tx = (ps.txLevels && ps.txLevels.length) ? ps.txLevels.join(', ') : '';
    var rx = (ps.rxLevels && ps.rxLevels.length) ? ps.rxLevels.join(', ') : '';
    return (
      '<article class="lab-settings-cms__perf-device" data-lab-perf-tool="' + escapeHtml(toolKey) + '">' +
        '<h4>' + escapeHtml(label) + '</h4>' +
        '<div class="lab-settings-cms__perf-grid">' +
          '<label class="lab-settings-cms__field lab-settings-cms__field--inline">' +
            '<span>Power min (dBm)</span>' +
            '<input type="number" step="0.1" value="' + escapeAttr(range.min != null ? String(range.min) : '') + '" ' +
              'data-lab-perf="powerMin" data-tool-key="' + escapeAttr(toolKey) + '">' +
          '</label>' +
          '<label class="lab-settings-cms__field lab-settings-cms__field--inline">' +
            '<span>Power max (dBm)</span>' +
            '<input type="number" step="0.1" value="' + escapeAttr(range.max != null ? String(range.max) : '') + '" ' +
              'data-lab-perf="powerMax" data-tool-key="' + escapeAttr(toolKey) + '">' +
          '</label>' +
          '<label class="lab-settings-cms__field">' +
            '<span>TX levels (comma-separated dBm)</span>' +
            '<input type="text" value="' + escapeAttr(tx) + '" data-lab-perf="txLevels" data-tool-key="' + escapeAttr(toolKey) + '">' +
          '</label>' +
          '<label class="lab-settings-cms__field">' +
            '<span>RX levels (comma-separated dBm)</span>' +
            '<input type="text" value="' + escapeAttr(rx) + '" data-lab-perf="rxLevels" data-tool-key="' + escapeAttr(toolKey) + '">' +
          '</label>' +
        '</div>' +
      '</article>'
    );
  }

  function renderSfpVariantEditor(variant) {
    var ps = variant.performanceSpecs || {};
    var range = ps.powerRangeDbm || {};
    return (
      '<article class="lab-settings-cms__sfp-variant' +
      (variant.id === selectedSfpVariantId ? ' is-active' : '') +
      '" data-sfp-variant="' + escapeHtml(variant.id) + '">' +
        '<div class="lab-settings-cms__sfp-head">' +
          '<strong>' + escapeHtml(variant.shortName || variant.name) + '</strong>' +
          '<button type="button" class="lab-settings-cms__btn lab-settings-cms__btn--ghost" data-sfp-select="' +
            escapeHtml(variant.id) + '">Edit</button>' +
          '<button type="button" class="lab-settings-cms__btn lab-settings-cms__btn--ghost" data-sfp-remove="' +
            escapeHtml(variant.id) + '">Remove</button>' +
        '</div>' +
        (variant.id === selectedSfpVariantId
          ? '<div class="lab-settings-cms__fields">' +
              '<label class="lab-settings-cms__field"><span>Variant name</span>' +
                '<input type="text" value="' + escapeAttr(variant.name) + '" data-sfp-field="name" data-sfp-id="' +
                escapeAttr(variant.id) + '"></label>' +
              '<label class="lab-settings-cms__field"><span>Short label</span>' +
                '<input type="text" value="' + escapeAttr(variant.shortName) + '" data-sfp-field="shortName" data-sfp-id="' +
                escapeAttr(variant.id) + '"></label>' +
              '<div class="lab-settings-cms__perf-grid">' +
                '<label class="lab-settings-cms__field lab-settings-cms__field--inline"><span>TX λ (nm)</span>' +
                  '<input type="number" value="' + escapeAttr(String(variant.txNm || 1490)) + '" data-sfp-field="txNm" data-sfp-id="' +
                  escapeAttr(variant.id) + '"></label>' +
                '<label class="lab-settings-cms__field lab-settings-cms__field--inline"><span>RX λ (nm)</span>' +
                  '<input type="number" value="' + escapeAttr(String(variant.rxNm || 1310)) + '" data-sfp-field="rxNm" data-sfp-id="' +
                  escapeAttr(variant.id) + '"></label>' +
                '<label class="lab-settings-cms__field lab-settings-cms__field--inline"><span>Power min (dBm)</span>' +
                  '<input type="number" step="0.1" value="' + escapeAttr(range.min != null ? String(range.min) : '') +
                  '" data-sfp-perf="powerMin" data-sfp-id="' + escapeAttr(variant.id) + '"></label>' +
                '<label class="lab-settings-cms__field lab-settings-cms__field--inline"><span>Power max (dBm)</span>' +
                  '<input type="number" step="0.1" value="' + escapeAttr(range.max != null ? String(range.max) : '') +
                  '" data-sfp-perf="powerMax" data-sfp-id="' + escapeAttr(variant.id) + '"></label>' +
                '<label class="lab-settings-cms__field"><span>TX levels (dBm)</span>' +
                  '<input type="text" value="' + escapeAttr((ps.txLevels || []).join(', ')) +
                  '" data-sfp-perf="txLevels" data-sfp-id="' + escapeAttr(variant.id) + '"></label>' +
                '<label class="lab-settings-cms__field"><span>RX levels / sensitivity (dBm)</span>' +
                  '<input type="text" value="' + escapeAttr((ps.rxLevels || []).join(', ')) +
                  '" data-sfp-perf="rxLevels" data-sfp-id="' + escapeAttr(variant.id) + '"></label>' +
                '<label class="lab-settings-cms__field lab-settings-cms__field--inline"><span>Default TX (dBm)</span>' +
                  '<input type="number" step="0.1" value="' + escapeAttr(ps.txDefault != null ? String(ps.txDefault) : '') +
                  '" data-sfp-perf="txDefault" data-sfp-id="' + escapeAttr(variant.id) + '"></label>' +
              '</div>' +
            '</div>'
          : '') +
      '</article>'
    );
  }

  function renderPerformanceTab() {
    var host = $(cms.bodyId);
    if (!host || !store()) return;
    var draft = store().getDraft();
    var html = '<section class="lab-settings-cms__section">' +
      '<h3 class="lab-settings-cms__cat">SFP Variants</h3>' +
      '<p class="lab-settings-cms__hint">Manage transceiver types installed in OLT SFP cages.</p>' +
      '<div class="lab-settings-cms__sfp-list">';
    (draft.sfpVariants || []).forEach(function (v) {
      html += renderSfpVariantEditor(v);
    });
    html += '</div>' +
      '<button type="button" class="lab-settings-cms__btn lab-settings-cms__btn--primary" id="lab-settings-add-sfp">+ Add SFP Variant</button>' +
      '</section>' +
      '<section class="lab-settings-cms__section">' +
      '<h3 class="lab-settings-cms__cat">Device Performance Specs</h3>';
    (draft.items || []).forEach(function (item) {
      if (store().PERFORMANCE_TOOL_KEYS.indexOf(item.toolKey) < 0) return;
      html += renderPerformanceFields(item.toolKey, item.performanceSpecs, item.label);
    });
    html += '</section>';
    host.innerHTML = html;
    if (!selectedSfpVariantId && draft.sfpVariants && draft.sfpVariants[0]) {
      selectedSfpVariantId = draft.sfpVariants[0].id;
    }
  }

  function renderDevicesTab() {
    var host = $(cms.bodyId);
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
          '<article class="lab-settings-cms__device" data-lab-device="' + escapeHtml(item.toolKey) + '">' +
            '<div class="lab-settings-cms__row lab-settings-cms__row--head">' +
              '<div class="lab-settings-cms__preview" aria-hidden="true">' +
                '<span class="' + previewClass + ' lab-settings-cms__mark"' + previewStyle + '></span>' +
              '</div>' +
              '<div class="lab-settings-cms__meta">' +
                '<strong>' + escapeHtml(item.label) + '</strong>' +
                '<span>' + escapeHtml(item.sublabel) + '</span>' +
              '</div>' +
              '<div class="lab-settings-cms__actions">' +
                '<label class="lab-settings-cms__visibility">' +
                  '<span>Visible</span>' +
                  '<input type="checkbox" class="toggle-tool-visibility" ' +
                    (item.visible !== false ? 'checked ' : '') +
                    'data-lab-field="visible" data-tool-key="' + escapeAttr(item.toolKey) + '">' +
                '</label>' +
                '<label class="lab-settings-cms__upload">' +
                  'Upload icon' +
                  '<input type="file" accept="image/png, image/svg+xml, image/jpeg" ' +
                    'data-lab-icon-upload="' + escapeHtml(item.toolKey) + '">' +
                '</label>' +
                '<button type="button" class="lab-settings-cms__btn lab-settings-cms__btn--ghost" ' +
                  'data-lab-icon-clear="' + escapeHtml(item.toolKey) + '"' +
                  (item.icon ? '' : ' disabled') + '>Clear icon</button>' +
              '</div>' +
            '</div>' +
            '<div class="lab-settings-cms__fields">' +
              '<label class="lab-settings-cms__field">' +
                '<span>Device title / name</span>' +
                '<input type="text" value="' + escapeAttr(item.label) + '" ' +
                  'data-lab-field="label" data-tool-key="' + escapeAttr(item.toolKey) + '">' +
              '</label>' +
              '<label class="lab-settings-cms__field">' +
                '<span>Subtitle (toolbox)</span>' +
                '<input type="text" value="' + escapeAttr(item.sublabel) + '" ' +
                  'data-lab-field="sublabel" data-tool-key="' + escapeAttr(item.toolKey) + '">' +
              '</label>' +
              '<label class="lab-settings-cms__field">' +
                '<span>Description / guide (properties pane)</span>' +
                '<textarea rows="2" data-lab-field="guideText" data-tool-key="' + escapeAttr(item.toolKey) + '">' +
                  escapeHtml(item.guideText) +
                '</textarea>' +
              '</label>' +
              renderSpecsFields(item) +
            '</div>' +
          '</article>';
      });
      html += '</section>';
    });
    host.innerHTML = html;
    syncToolbar();
  }

  function ensureModal() {
    if ($(cms.modalId)) return;
    var wrap = document.createElement('div');
    wrap.id = cms.modalId;
    wrap.className = 'lab-settings-cms';
    wrap.hidden = true;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', cms.titleId);
    wrap.innerHTML =
      '<div class="lab-settings-cms__backdrop" data-lab-settings-close></div>' +
      '<div class="lab-settings-cms__panel">' +
        '<header class="lab-settings-cms__header">' +
          '<div>' +
            '<h2 id="' + cms.titleId + '">' + cms.title + '</h2>' +
            '<p>' + cms.subtitle + '</p>' +
          '</div>' +
          '<div class="lab-settings-cms__toolbar">' +
            '<button type="button" class="lab-settings-cms__btn" id="' + cms.undoId + '" title="Ctrl+Z">Undo</button>' +
            '<button type="button" class="lab-settings-cms__btn" id="' + cms.redoId + '" title="Ctrl+Y">Redo</button>' +
            '<button type="button" class="lab-settings-cms__btn lab-settings-cms__btn--warn" id="' + cms.resetId + '">Reset to Defaults</button>' +
            '<button type="button" class="lab-settings-cms__btn lab-settings-cms__btn--primary" id="' + cms.saveId + '">Save Changes</button>' +
            '<button type="button" class="lab-settings-cms__btn" data-lab-settings-close>إغلاق</button>' +
          '</div>' +
        '</header>' +
        '<nav class="lab-settings-cms__tabs" aria-label="Settings sections">' +
          '<button type="button" class="lab-settings-cms__tab is-active" data-lab-settings-tab="devices">Devices &amp; Icons</button>' +
          '<button type="button" class="lab-settings-cms__tab" data-lab-settings-tab="performance">Performance Specs</button>' +
        '</nav>' +
        '<div class="lab-settings-cms__body" id="' + cms.bodyId + '"></div>' +
        '<p class="lab-settings-cms__status" id="' + cms.statusId + '"></p>' +
      '</div>';
    document.body.appendChild(wrap);
    bindModal(wrap);
  }

  function refresh() {
    if (activeTab === 'performance') renderPerformanceTab();
    else renderDevicesTab();
    syncToolbar();
  }

  function commitPerformanceField(toolKey, field, value) {
    if (!store() || !toolKey) return;
    var item = store().getDraft().items.filter(function (it) { return it.toolKey === toolKey; })[0];
    if (!item) return;
    var ps = Object.assign({}, item.performanceSpecs || {});
    var range = Object.assign({}, ps.powerRangeDbm || {});
    if (field === 'powerMin') range.min = value === '' ? null : Number(value);
    if (field === 'powerMax') range.max = value === '' ? null : Number(value);
    if (field === 'txLevels') ps.txLevels = store().parseTxLevels(value);
    if (field === 'rxLevels') ps.rxLevels = store().parseTxLevels(value);
    ps.powerRangeDbm = range;
    store().updateItem(toolKey, { performanceSpecs: ps }, true);
  }

  function commitSfpVariantField(variantId, field, value) {
    if (!store() || !variantId) return;
    var patch = {};
    if (field === 'name' || field === 'shortName') patch[field] = value;
    if (field === 'txNm' || field === 'rxNm') patch[field] = Number(value);
    store().updateSfpVariant(variantId, patch, true);
  }

  function commitSfpVariantPerf(variantId, field, value) {
    if (!store() || !variantId) return;
    var variant = store().getDraft().sfpVariants.filter(function (v) { return v.id === variantId; })[0];
    if (!variant) return;
    var ps = Object.assign({}, variant.performanceSpecs || {});
    var range = Object.assign({}, ps.powerRangeDbm || {});
    if (field === 'powerMin') range.min = value === '' ? null : Number(value);
    if (field === 'powerMax') range.max = value === '' ? null : Number(value);
    if (field === 'txLevels') ps.txLevels = store().parseTxLevels(value);
    if (field === 'rxLevels') ps.rxLevels = store().parseTxLevels(value);
    if (field === 'txDefault') ps.txDefault = Number(value);
    ps.powerRangeDbm = range;
    store().updateSfpVariant(variantId, { performanceSpecs: ps }, true);
  }

  function commitField(toolKey, field, value) {
    if (!store() || !toolKey || !field) return;
    var patch = {};
    patch[field] = field === 'visible' ? !!value : value;
    store().updateItem(toolKey, patch, true);
  }

  function commitSpecField(toolKey, specKey, value) {
    if (!store() || !toolKey || !specKey) return;
    var item = store().getDraft().items.filter(function (it) { return it.toolKey === toolKey; })[0];
    if (!item) return;
    var specs = Object.assign({}, item.specs || {});
    if (specKey === 'txLevels') {
      specs.txLevels = store().parseTxLevels(value);
    } else if (specKey === 'defaultTxDbm') {
      specs.defaultTxDbm = Number(value);
    }
    store().updateItem(toolKey, { specs: specs }, true);
  }

  function commitSplitterLoss(toolKey, ratio, value) {
    if (!store() || toolKey !== 'splitter' || !ratio) return;
    var item = store().getDraft().items.filter(function (it) { return it.toolKey === 'splitter'; })[0];
    if (!item) return;
    var losses = Object.assign({}, (item.specs && item.specs.losses) || store().DEFAULT_SPLITTER_LOSSES);
    var n = Number(value);
    if (isFinite(n)) losses[ratio] = n;
    store().updateItem('splitter', { specs: { losses: losses } }, true);
  }

  function bindModal(root) {
    root.querySelectorAll('[data-lab-settings-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });

    root.addEventListener('change', function (e) {
      var input = e.target;
      if (!input || !input.getAttribute) return;

      if (input.getAttribute('data-lab-perf')) {
        commitPerformanceField(
          input.getAttribute('data-tool-key'),
          input.getAttribute('data-lab-perf'),
          input.value
        );
        setStatus('Performance specs updated · Save Changes to apply.');
        refresh();
        return;
      }

      if (input.getAttribute('data-sfp-field')) {
        commitSfpVariantField(
          input.getAttribute('data-sfp-id'),
          input.getAttribute('data-sfp-field'),
          input.value
        );
        setStatus('SFP variant updated · Save Changes to apply.');
        refresh();
        return;
      }

      if (input.getAttribute('data-sfp-perf')) {
        commitSfpVariantPerf(
          input.getAttribute('data-sfp-id'),
          input.getAttribute('data-sfp-perf'),
          input.value
        );
        setStatus('SFP performance updated · Save Changes to apply.');
        refresh();
        return;
      }

      if (input.getAttribute('data-lab-icon-upload')) {
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
        return;
      }

      if (input.getAttribute('data-lab-field')) {
        var fieldName = input.getAttribute('data-lab-field');
        commitField(
          input.getAttribute('data-tool-key'),
          fieldName,
          fieldName === 'visible' ? input.checked : input.value
        );
        setStatus(fieldName === 'visible'
          ? 'Toolbox visibility updated · Save Changes to persist.'
          : 'Updated · Save Changes to apply to workspace.');
        refresh();
        return;
      }

      if (input.getAttribute('data-lab-spec')) {
        commitSpecField(
          input.getAttribute('data-tool-key'),
          input.getAttribute('data-lab-spec'),
          input.value
        );
        setStatus('Specs updated · Save Changes to apply.');
        refresh();
        return;
      }

      if (input.getAttribute('data-lab-spec-loss')) {
        commitSplitterLoss(
          input.getAttribute('data-tool-key'),
          input.getAttribute('data-lab-spec-loss'),
          input.value
        );
        setStatus('Splitter loss updated · Save Changes to apply.');
        refresh();
      }
    });

    root.addEventListener('click', function (e) {
      var tabBtn = e.target.closest ? e.target.closest('[data-lab-settings-tab]') : null;
      if (tabBtn) {
        activeTab = tabBtn.getAttribute('data-lab-settings-tab') || 'devices';
        root.querySelectorAll('[data-lab-settings-tab]').forEach(function (btn) {
          btn.classList.toggle('is-active', btn.getAttribute('data-lab-settings-tab') === activeTab);
        });
        refresh();
        return;
      }
      var addSfp = e.target.id === 'lab-settings-add-sfp' ? e.target : null;
      if (addSfp && store()) {
        selectedSfpVariantId = store().addSfpVariant();
        activeTab = 'performance';
        setStatus('SFP variant added · Save Changes to apply.');
        refresh();
        return;
      }
      var selBtn = e.target.closest ? e.target.closest('[data-sfp-select]') : null;
      if (selBtn) {
        selectedSfpVariantId = selBtn.getAttribute('data-sfp-select');
        refresh();
        return;
      }
      var rmBtn = e.target.closest ? e.target.closest('[data-sfp-remove]') : null;
      if (rmBtn && store()) {
        var rid = rmBtn.getAttribute('data-sfp-remove');
        if (!window.confirm('Remove this SFP variant?')) return;
        if (!store().removeSfpVariant(rid)) {
          setStatus('Keep at least one SFP variant.', true);
          return;
        }
        if (selectedSfpVariantId === rid) selectedSfpVariantId = null;
        setStatus('SFP variant removed · Save Changes to apply.');
        refresh();
        return;
      }
      var clearBtn = e.target.closest ? e.target.closest('[data-lab-icon-clear]') : null;
      if (!clearBtn || !store()) return;
      var toolKey = clearBtn.getAttribute('data-lab-icon-clear');
      store().setToolIcon(toolKey, '', true);
      setStatus('Icon cleared · Save Changes to persist.');
      refresh();
    });

    $(cms.undoId).addEventListener('click', function () {
      if (store().undo()) {
        setStatus('Undo');
        refresh();
      }
    });
    $(cms.redoId).addEventListener('click', function () {
      if (store().redo()) {
        setStatus('Redo');
        refresh();
      }
    });
    $(cms.resetId).addEventListener('click', function () {
      if (window.confirm(cms.resetConfirm)) {
        store().resetToDefaults();
        setStatus('Draft reset to factory defaults. Click Save Changes to apply.');
        refresh();
      }
    });
    $(cms.saveId).addEventListener('click', function () {
      var ok = store().saveChanges();
      setStatus(ok ? 'Saved · toolbox and properties updated.' : 'Save failed (storage quota).', !ok);
      syncToolbar();
    });
  }

  function openModal() {
    if (!isAdminPreviewContext() || !store()) return;
    ensureModal();
    modalOpen = true;
    var modal = $(cms.modalId);
    modal.hidden = false;
    activeTab = 'devices';
    selectedSfpVariantId = null;
    store().discardDraft();
    var modalRoot = $(cms.modalId);
    if (modalRoot) {
      modalRoot.querySelectorAll('[data-lab-settings-tab]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-lab-settings-tab') === activeTab);
      });
    }
    refresh();
    setStatus('');
  }

  function closeModal() {
    modalOpen = false;
    var modal = $(cms.modalId);
    if (modal) modal.hidden = true;
    if (store()) {
      store().discardDraft();
      if (typeof store().applyToolboxPresentation === 'function') {
        store().applyToolboxPresentation();
      }
    }
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
    if ($('opm-admin-settings-btn')) useOpmCms();
    var btn = $(cms.buttonId);
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
      });
    }
    window.addEventListener('keydown', onKey, true);
    var draftEvt = store() && store().EVENTS && store().EVENTS.draft
      ? store().EVENTS.draft
      : 'ifa:ftth-lab-draft-changed';
    window.addEventListener(draftEvt, function () {
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
