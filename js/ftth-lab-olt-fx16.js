/**
 * Nokia 7360 ISAM FX-16 OLT + FGLT-D + SFP hierarchy
 * Blank-slate assembly: drag Chassis → FGLT-D → SFP (nothing pre-placed).
 */
(function (global) {
  'use strict';

  var SLOT_COUNT = 16;
  var PORT_COUNT = 16;

  var ctx = null;
  var el2d = null;
  var group3d = null;
  var root3d = null;
  var pickables = [];
  var stageDropBound = false;

  /* Blank slate — nothing on canvas until user places hardware */
  var chassisPlaced = false;
  var chassisInLibrary = true;
  var chassisScale = 1;
  var chassisX = 0;
  var chassisY = 0;
  var WORLD_SIZE = 20000;
  var CHASSIS_BASE_W = 1100;
  var CHASSIS_SCALE_MIN = 0.45;
  var CHASSIS_SCALE_MAX = 1.7;

  function getWorldSize() {
    return (global.FtthLab && FtthLab.getWorldSize) ? FtthLab.getWorldSize() : WORLD_SIZE;
  }

  function defaultChassisPos() {
    var world = getWorldSize();
    var w = Math.round(CHASSIS_BASE_W * chassisScale);
    return {
      x: Math.round(world / 2 - w / 2),
      y: Math.round(world / 2 - 180),
    };
  }

  /* installed[slot] = { id, model } — stock minted from toolbox on demand */
  var installed = {};
  var cardInventory = [];
  var sfpInventory = [];
  var sfpMap = {};

  var selection = {
    kind: 'none',
    slot: null,
    port: null,
    cardId: null,
    sfpId: null,
  };
  /** Sidebar arm highlight only — independent of workspace item selection */
  var armedToolbox = null;

  var portWiring = {};
  var dragState = null;
  var cardSeq = 0;
  var sfpSeq = 0;

  /* Undo / Redo history of hardware placement */
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var HISTORY_MAX = 80;

  function resetAssembly() {
    chassisPlaced = false;
    chassisInLibrary = true;
    chassisScale = 1;
    var pos = defaultChassisPos();
    chassisX = pos.x;
    chassisY = pos.y;
    installed = {};
    sfpMap = {};
    portWiring = {};
    cardInventory = [];
    sfpInventory = [];
    cardSeq = 0;
    sfpSeq = 0;
    selection = { kind: 'none', slot: null, port: null, cardId: null, sfpId: null };
    armedToolbox = null;
    history = [];
    historyIndex = -1;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function captureSnapshot() {
    return {
      chassisPlaced: chassisPlaced,
      chassisInLibrary: chassisInLibrary,
      chassisScale: chassisScale,
      chassisX: chassisX,
      chassisY: chassisY,
      installed: cloneJson(installed),
      sfpMap: cloneJson(sfpMap),
      cardSeq: cardSeq,
      sfpSeq: sfpSeq,
    };
  }

  function rebuildWiringFromMaps() {
    portWiring = {};
    for (var s = 1; s <= SLOT_COUNT; s++) {
      if (!installed[s]) continue;
      ensureSlotWiring(s);
      if (!sfpMap[s]) continue;
      Object.keys(sfpMap[s]).forEach(function (pk) {
        var id = portId(s, parseInt(pk, 10));
        if (portWiring[id]) portWiring[id].hasSfp = true;
      });
    }
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    chassisPlaced = !!snap.chassisPlaced;
    chassisInLibrary = !!snap.chassisInLibrary;
    chassisScale = typeof snap.chassisScale === 'number' ? snap.chassisScale : 1;
    chassisX = typeof snap.chassisX === 'number' ? snap.chassisX : defaultChassisPos().x;
    chassisY = typeof snap.chassisY === 'number' ? snap.chassisY : defaultChassisPos().y;
    installed = cloneJson(snap.installed) || {};
    sfpMap = cloneJson(snap.sfpMap) || {};
    cardSeq = snap.cardSeq || 0;
    sfpSeq = snap.sfpSeq || 0;
    cardInventory = [];
    sfpInventory = [];
    rebuildWiringFromMaps();
    selection = { kind: 'none', slot: null, port: null, cardId: null, sfpId: null };
    rebuildViews();
    var hud = document.getElementById('lab-hud-mode');
    if (hud) {
      hud.textContent = chassisPlaced
        ? '2D Layout · FX-16 Chassis'
        : '2D Layout · Empty Workspace';
    }
    if (chassisPlaced) selectChassis();
    else {
      updateInspector();
      renderToolbox();
    }
    historyLocked = false;
    updateUndoRedoUi();
  }

  function updateUndoRedoUi() {
    if (global.FtthLab && typeof FtthLab.updateHistoryUi === 'function') {
      FtthLab.updateHistoryUi();
      return;
    }
    var undoBtn = document.getElementById('lab-btn-undo');
    var redoBtn = document.getElementById('lab-btn-redo');
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) {
      history.shift();
    }
    historyIndex = history.length - 1;
    updateUndoRedoUi();
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('olt-fx16');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    return true;
  }

  function deleteSelected() {
    if (selection.kind === 'port' && hasSfp(selection.slot, selection.port)) {
      ejectSfp(selection.slot, selection.port);
      return true;
    }
    if (selection.kind === 'card' ||
        (selection.kind === 'slot' && selection.slot && installed[selection.slot])) {
      ejectCard(selection.slot);
      return true;
    }
    if (selection.kind === 'chassis' && chassisPlaced) {
      removeChassis();
      return true;
    }
    return false;
  }

  function clampChassisScale(v) {
    return Math.max(CHASSIS_SCALE_MIN, Math.min(CHASSIS_SCALE_MAX, v));
  }

  function applyChassisLayout() {
    if (!el2d || !chassisPlaced) return;
    var frame = el2d.querySelector('.lab-fx-chassis-frame');
    var w = Math.round(CHASSIS_BASE_W * chassisScale);
    if (frame) {
      frame.style.width = w + 'px';
      frame.style.setProperty('--fx-scale', String(chassisScale));
    }
    el2d.style.left = Math.round(chassisX) + 'px';
    el2d.style.top = Math.round(chassisY) + 'px';
    el2d.style.width = w + 'px';
    el2d.style.maxWidth = 'none';
    el2d.style.maxHeight = 'none';
    el2d.style.transform = 'none';
    el2d.style.overflow = 'visible';
  }

  /** Toolbox tools are always available — mint stock on demand */
  function takeNextCard() {
    cardSeq += 1;
    var card = { id: 'fglt-d-' + cardSeq, model: 'FGLT-D' };
    cardInventory.push(card);
    return card.id;
  }

  function takeNextSfp() {
    sfpSeq += 1;
    var mod = { id: 'sfp-' + sfpSeq, model: 'GPON-SFP' };
    sfpInventory.push(mod);
    return mod.id;
  }

  function portId(slot, port) {
    return 'fx16-lt' + slot + '-pon' + port;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function ensureSlotWiring(slot) {
    if (!sfpMap[slot]) sfpMap[slot] = {};
    for (var p = 1; p <= PORT_COUNT; p++) {
      var id = portId(slot, p);
      if (!portWiring[id]) {
        portWiring[id] = {
          portId: id,
          slot: slot,
          port: p,
          connected: false,
          jumperId: null,
          peer: null,
          readyForJumper: true,
          hasSfp: false,
          polish: 'UPC',
        };
      }
    }
  }

  function clearSlotWiring(slot) {
    for (var p = 1; p <= PORT_COUNT; p++) {
      delete portWiring[portId(slot, p)];
    }
    delete sfpMap[slot];
  }

  function findCardInv(cardId) {
    for (var i = 0; i < cardInventory.length; i++) {
      if (cardInventory[i].id === cardId) return cardInventory[i];
    }
    return null;
  }

  function findSfpInv(sfpId) {
    for (var i = 0; i < sfpInventory.length; i++) {
      if (sfpInventory[i].id === sfpId) return sfpInventory[i];
    }
    return null;
  }

  function findInstalledSlot(cardId) {
    for (var s = 1; s <= SLOT_COUNT; s++) {
      if (installed[s] && installed[s].id === cardId) return s;
    }
    return null;
  }

  function hasSfp(slot, port) {
    return !!(sfpMap[slot] && sfpMap[slot][port]);
  }

  /* ─── Chassis place / remove ─── */

  function placeChassis() {
    if (chassisPlaced) {
      setStatus('Chassis already on workspace');
      return false;
    }
    chassisPlaced = true;
    chassisInLibrary = false;
    var pos = defaultChassisPos();
    chassisX = pos.x;
    chassisY = pos.y;
    chassisScale = 1;
    rebuildViews();
    selectChassis();
    var hud = document.getElementById('lab-hud-mode');
    if (hud) hud.textContent = '2D Layout · FX-16 Chassis';
    pushHistory();
    setStatus('FX-16 placed · drag chassis to move · corner handles to resize');
    return true;
  }

  function removeChassis() {
    if (!chassisPlaced) return false;
    /* Clear all cards + SFPs with chassis */
    for (var s = 1; s <= SLOT_COUNT; s++) {
      if (installed[s]) {
        clearSlotWiring(s);
        delete installed[s];
      }
    }
    cardInventory = [];
    sfpInventory = [];
    chassisPlaced = false;
    chassisInLibrary = true;
    chassisScale = 1;
    var pos = defaultChassisPos();
    chassisX = pos.x;
    chassisY = pos.y;
    rebuildViews();
    selectLibraryChassis();
    var hud = document.getElementById('lab-hud-mode');
    if (hud) hud.textContent = '2D Layout · Empty Workspace';
    pushHistory();
    setStatus('Chassis removed · workspace empty · drag FX-16 from the toolbox to restart');
    return true;
  }

  /* ─── Card install / eject ─── */

  function installCard(cardId, slot) {
    if (!chassisPlaced) {
      setStatus('Place the FX-16 chassis on the workspace first');
      return false;
    }
    slot = parseInt(slot, 10);
    if (slot < 1 || slot > SLOT_COUNT) return false;
    if (installed[slot]) {
      setStatus('LT' + pad2(slot) + ' occupied — eject first');
      return false;
    }

    var card = cardId ? findCardInv(cardId) : null;
    var fromSlot = cardId ? findInstalledSlot(cardId) : null;
    if (!card && fromSlot == null) {
      cardId = takeNextCard();
      card = findCardInv(cardId);
    }
    if (card) {
      cardInventory = cardInventory.filter(function (c) { return c.id !== cardId; });
    } else if (fromSlot != null) {
      if (fromSlot === slot) return true;
      card = installed[fromSlot];
      var movedSfps = sfpMap[fromSlot] || {};
      delete installed[fromSlot];
      delete sfpMap[fromSlot];
      for (var p = 1; p <= PORT_COUNT; p++) delete portWiring[portId(fromSlot, p)];
      installed[slot] = { id: card.id, model: card.model || 'FGLT-D' };
      ensureSlotWiring(slot);
      sfpMap[slot] = movedSfps;
      Object.keys(movedSfps).forEach(function (pk) {
        var port = parseInt(pk, 10);
        if (portWiring[portId(slot, port)]) {
          portWiring[portId(slot, port)].hasSfp = true;
        }
      });
      rebuildViews();
      selectCard(slot);
      pushHistory();
      setStatus('FGLT-D moved to LT' + pad2(slot));
      return true;
    } else {
      return false;
    }

    installed[slot] = { id: card.id, model: card.model || 'FGLT-D' };
    ensureSlotWiring(slot);
    if (!sfpMap[slot]) sfpMap[slot] = {};
    rebuildViews();
    selectCard(slot);
    pushHistory();
    setStatus('FGLT-D seated in LT' + pad2(slot) + ' · drag SFP modules into square ports');
    return true;
  }

  function ejectCard(slot) {
    slot = parseInt(slot, 10);
    if (!installed[slot]) return false;
    delete installed[slot];
    clearSlotWiring(slot);
    rebuildViews();
    selectSlot(slot);
    pushHistory();
    setStatus('FGLT-D ejected from LT' + pad2(slot));
    return true;
  }

  /* ─── SFP insert / remove ─── */

  function installSfp(sfpId, slot, port) {
    if (!chassisPlaced) {
      setStatus('Place the FX-16 chassis first');
      return false;
    }
    slot = parseInt(slot, 10);
    port = parseInt(port, 10);
    if (!installed[slot]) {
      setStatus('Install an FGLT-D card before inserting SFP modules');
      return false;
    }
    if (port < 1 || port > PORT_COUNT) return false;
    if (!sfpMap[slot]) sfpMap[slot] = {};
    if (sfpMap[slot][port]) {
      setStatus('Port ' + port + ' already has an SFP — remove it first');
      return false;
    }
    var mod = sfpId ? findSfpInv(sfpId) : null;
    if (!mod) {
      sfpId = takeNextSfp();
      mod = findSfpInv(sfpId);
    }
    if (!mod) return false;
    sfpInventory = sfpInventory.filter(function (m) { return m.id !== sfpId; });
    sfpMap[slot][port] = mod;
    if (portWiring[portId(slot, port)]) {
      portWiring[portId(slot, port)].hasSfp = true;
      if (!portWiring[portId(slot, port)].polish) {
        portWiring[portId(slot, port)].polish = 'UPC';
      }
    }
    rebuildViews();
    selectPort(slot, port);
    pushHistory();
    setStatus('SFP seated in LT' + pad2(slot) + ' · Port ' + port + ' · jumper-ready');
    return true;
  }

  function ejectSfp(slot, port) {
    slot = parseInt(slot, 10);
    port = parseInt(port, 10);
    if (!sfpMap[slot] || !sfpMap[slot][port]) return false;
    delete sfpMap[slot][port];
    if (portWiring[portId(slot, port)]) portWiring[portId(slot, port)].hasSfp = false;
    rebuildViews();
    selectPort(slot, port);
    pushHistory();
    setStatus('SFP removed from Port ' + port);
    return true;
  }

  /* ─── Selection ─── */

  function claimSelection() {
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('olt-fx16');
    }
  }

  function claimOltToolbox() {
    if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
      FtthLab.claimToolboxTool('olt-fx16');
    }
  }

  function disarmToolboxHighlight() {
    if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
      FtthLab.claimToolboxTool(null);
    } else {
      armedToolbox = null;
      renderToolbox();
    }
  }

  function selectLibraryChassis(opts) {
    opts = opts || {};
    claimSelection();
    claimOltToolbox();
    armedToolbox = 'chassis';
    selection = { kind: 'lib-chassis', slot: null, port: null, cardId: null, sfpId: null };
    updateInspector();
    if (!opts.keepToolbox) renderToolbox();
    setStatus('FX-16 selected · drag onto the empty workspace grid to place');
  }

  function selectChassis(opts) {
    opts = opts || {};
    if (!chassisPlaced) {
      selectLibraryChassis();
      return;
    }
    claimSelection();
    selection = { kind: 'chassis', slot: null, port: null, cardId: null, sfpId: null };
    updateInspector();
    if (opts.keepArm || armedToolbox) renderToolbox();
    setStatus('FX-16 on workspace · drag FGLT-D into LT slots 01–16');
  }

  function selectSlot(slot) {
    claimSelection();
    selection = { kind: 'slot', slot: slot, port: null, cardId: null, sfpId: null };
    updateInspector();
    setStatus(installed[slot]
      ? 'LT' + pad2(slot) + ' · FGLT-D installed'
      : 'LT' + pad2(slot) + ' · blanking plate · drop FGLT-D here');
  }

  function selectCard(slot) {
    if (!installed[slot]) {
      selectSlot(slot);
      return;
    }
    claimSelection();
    selection = {
      kind: 'card',
      slot: slot,
      port: null,
      cardId: installed[slot].id,
      sfpId: null,
    };
    updateInspector();
    setStatus('FGLT-D in LT' + pad2(slot) + ' · drag SFP into square ports 1–16');
  }

  function selectPort(slot, port) {
    if (!installed[slot]) return;
    claimSelection();

    /* Smart Splitter patch mode — validate UPC/APC before normal select */
    if (hasSfp(slot, port) && global.FtthLab && typeof FtthLab.tryPatchPort === 'function') {
      var wiring = portWiring[portId(slot, port)] || {};
      var handled = FtthLab.tryPatchPort({
        owner: 'olt',
        polish: wiring.polish || 'UPC',
        label: 'LT' + pad2(slot) + '/P' + port,
        slot: slot,
        oltPort: port,
      });
      if (handled) {
        selection = {
          kind: 'port',
          slot: slot,
          port: port,
          cardId: installed[slot].id,
          sfpId: sfpMap[slot][port].id,
        };
        updateInspector();
        return;
      }
    }

    selection = {
      kind: 'port',
      slot: slot,
      port: port,
      cardId: installed[slot].id,
      sfpId: hasSfp(slot, port) ? sfpMap[slot][port].id : null,
    };
    updateInspector();
    setStatus(
      hasSfp(slot, port)
        ? 'Port ' + port + ' · SFP active · ' + portId(slot, port) +
          ' · ' + ((portWiring[portId(slot, port)] && portWiring[portId(slot, port)].polish) || 'UPC')
        : 'Port ' + port + ' · empty square cage · drop SFP module'
    );
  }

  function selectLibraryCard(cardId, opts) {
    opts = opts || {};
    claimSelection();
    claimOltToolbox();
    armedToolbox = 'card';
    selection = { kind: 'lib-card', slot: null, port: null, cardId: cardId, sfpId: null };
    updateInspector();
    if (!opts.keepToolbox) renderToolbox();
    setStatus('FGLT-D selected · drop onto empty LT slot 01–16');
  }

  function selectLibrarySfp(sfpId, opts) {
    opts = opts || {};
    claimSelection();
    claimOltToolbox();
    armedToolbox = 'sfp';
    selection = { kind: 'lib-sfp', slot: null, port: null, cardId: null, sfpId: sfpId };
    updateInspector();
    if (!opts.keepToolbox) renderToolbox();
    setStatus('SFP selected · drop onto an empty square port on an installed FGLT-D');
  }

  /* ─── Simple 3-item toolbox drawer ─── */

  function renderToolbox() {
    var host = document.getElementById('lab-hw-tree');
    if (!host) return;

    var chassisSel = armedToolbox === 'chassis';
    var cardSel = armedToolbox === 'card';
    var sfpSel = armedToolbox === 'sfp';

    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool' + (chassisSel ? ' is-selected' : '') +
      (chassisPlaced ? ' is-used' : '') +
      '" draggable="' + (chassisPlaced ? 'false' : 'true') +
      '" data-lab-tool="chassis" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--chassis" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy"><strong>Nokia 7360 FX-16</strong><span>OLT</span></span>' +
      '</button>' +
      '<button type="button" class="lab-tool' + (cardSel ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="card" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--card" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy"><strong>FGLT-D Line Card</strong><span>Line card</span></span>' +
      '</button>' +
      '<button type="button" class="lab-tool' + (sfpSel ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="sfp" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--sfp" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy"><strong>SFP Transceiver</strong><span>Optical module</span></span>' +
      '</button>' +
      '</div>';

    bindToolboxEvents(host);
  }

  function occupiedSlots() {
    var list = [];
    for (var s = 1; s <= SLOT_COUNT; s++) {
      if (installed[s]) list.push(s);
    }
    return list;
  }

  function beginLabDrag(payload) {
    if (global.FtthLab && typeof FtthLab.beginDrag === 'function') {
      FtthLab.beginDrag(payload);
    }
  }

  function endLabDrag() {
    if (global.FtthLab && typeof FtthLab.endDrag === 'function') {
      FtthLab.endDrag();
    }
    if (global.FtthLab && typeof FtthLab.clearStageDropHighlight === 'function') {
      FtthLab.clearStageDropHighlight();
    }
  }

  function getLabDrag() {
    if (global.FtthLab && typeof FtthLab.getActiveDrag === 'function') {
      return FtthLab.getActiveDrag();
    }
    return null;
  }

  function bindToolboxEvents(host) {
    var chassisBtn = host.querySelector('[data-lab-tool="chassis"]');
    var cardBtn = host.querySelector('[data-lab-tool="card"]');
    var sfpBtn = host.querySelector('[data-lab-tool="sfp"]');

    if (chassisBtn) {
      chassisBtn.addEventListener('click', function () {
        claimOltToolbox();
        armedToolbox = 'chassis';
        if (chassisPlaced) selectChassis({ keepArm: true });
        else selectLibraryChassis({ keepToolbox: true });
        renderToolbox();
      });
      chassisBtn.addEventListener('dragstart', function (e) {
        if (chassisPlaced) {
          e.preventDefault();
          setStatus('Chassis already on workspace');
          return;
        }
        dragState = { type: 'chassis' };
        beginLabDrag({ kind: 'chassis' });
        try {
          e.dataTransfer.setData('text/plain', 'lab:chassis');
          e.dataTransfer.setData('text/lab-drag', 'chassis');
          e.dataTransfer.effectAllowed = 'copy';
        } catch (err) { /* ignore */ }
        chassisBtn.classList.add('is-dragging', 'is-selected');
        /* keepToolbox: rebuilding HTML mid-drag cancels HTML5 DnD */
        selectLibraryChassis({ keepToolbox: true });
      });
      chassisBtn.addEventListener('dragend', function () {
        dragState = null;
        endLabDrag();
        chassisBtn.classList.remove('is-dragging');
        clearDropHighlights();
        renderToolbox();
      });
    }

    if (cardBtn) {
      cardBtn.addEventListener('click', function () {
        selectLibraryCard(null);
      });
      cardBtn.addEventListener('dragstart', function (e) {
        if (!chassisPlaced) {
          e.preventDefault();
          setStatus('Place the FX-16 chassis on the workspace first');
          return;
        }
        var cardId = takeNextCard();
        dragState = { type: 'card', cardId: cardId };
        beginLabDrag({ kind: 'card', cardId: cardId });
        try {
          e.dataTransfer.setData('text/plain', 'lab:card:' + cardId);
          e.dataTransfer.setData('text/lab-drag', 'card');
          e.dataTransfer.setData('text/lab-card-id', cardId);
          e.dataTransfer.effectAllowed = 'copy';
        } catch (err) { /* ignore */ }
        cardBtn.classList.add('is-dragging', 'is-selected');
        selectLibraryCard(cardId, { keepToolbox: true });
      });
      cardBtn.addEventListener('dragend', function () {
        dragState = null;
        endLabDrag();
        cardBtn.classList.remove('is-dragging');
        clearDropHighlights();
        renderToolbox();
      });
    }

    if (sfpBtn) {
      sfpBtn.addEventListener('click', function () {
        selectLibrarySfp(null);
      });
      sfpBtn.addEventListener('dragstart', function (e) {
        if (!occupiedSlots().length) {
          e.preventDefault();
          setStatus('Install an FGLT-D card before placing SFP modules');
          return;
        }
        var sfpId = takeNextSfp();
        dragState = { type: 'sfp', sfpId: sfpId };
        beginLabDrag({ kind: 'sfp', sfpId: sfpId });
        try {
          e.dataTransfer.setData('text/plain', 'lab:sfp:' + sfpId);
          e.dataTransfer.setData('text/lab-drag', 'sfp');
          e.dataTransfer.setData('text/lab-sfp-id', sfpId);
          e.dataTransfer.effectAllowed = 'copy';
        } catch (err) { /* ignore */ }
        sfpBtn.classList.add('is-dragging', 'is-selected');
        selectLibrarySfp(sfpId, { keepToolbox: true });
      });
      sfpBtn.addEventListener('dragend', function () {
        dragState = null;
        endLabDrag();
        sfpBtn.classList.remove('is-dragging');
        clearDropHighlights();
        renderToolbox();
      });
    }
  }

  function clearDropHighlights() {
    document.querySelectorAll('.is-drop-target').forEach(function (n) {
      n.classList.remove('is-drop-target');
    });
  }

  function isChassisDragPayload() {
    var active = getLabDrag();
    if (active && active.kind === 'chassis') return true;
    return !!(dragState && dragState.type === 'chassis');
  }

  function bindStageDrop() {
    if (stageDropBound) return;
    stageDropBound = true;

    function onDragOver(e) {
      if (chassisPlaced) return;
      if (!isChassisDragPayload()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      var zone = e.currentTarget;
      if (zone) zone.classList.add('is-drop-target');
    }

    function onDragLeave(e) {
      var zone = e.currentTarget;
      if (!zone) return;
      var related = e.relatedTarget;
      if (related && zone.contains(related)) return;
      zone.classList.remove('is-drop-target');
    }

    function onDrop(e) {
      var active = getLabDrag();
      var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
        (active && active.kind) ||
        (dragState && dragState.type);
      if (kind !== 'chassis') return;
      e.preventDefault();
      e.stopPropagation();
      var zone = e.currentTarget;
      if (zone) zone.classList.remove('is-drop-target');
      placeChassis();
      dragState = null;
      endLabDrag();
    }

    ['lab-2d-mount', 'lab-canvas-2d', 'lab-2d-world', 'lab-canvas-3d'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('dragover', onDragOver);
      el.addEventListener('dragleave', onDragLeave);
      el.addEventListener('drop', onDrop);
    });
  }

  /* ─── Inspector ─── */

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;

    var title = 'No selection';
    var body = 'Select equipment on the canvas, or drag an item from the toolbox.';

    if (selection.kind === 'lib-chassis') {
      title = 'Nokia 7360 FX-16 · OLT';
      body = 'Drag onto the workspace to place the chassis.';
    } else if (selection.kind === 'lib-card') {
      title = 'FGLT-D Line Card';
      body = chassisPlaced
        ? 'Drop onto an empty LT slot, or click a slot while selected.'
        : 'Place the FX-16 chassis before installing cards.';
    } else if (selection.kind === 'lib-sfp') {
      title = 'SFP Transceiver';
      body = occupiedSlots().length
        ? 'Drop onto an empty square port on an FGLT-D.'
        : 'Install an FGLT-D card first, then insert SFPs.';
    } else if (selection.kind === 'chassis') {
      title = 'Nokia 7360 ISAM FX-16';
      body = '16 LT slots · drag FGLT-D from the toolbox into a slot.';
    } else if (selection.kind === 'slot') {
      title = 'LT Slot ' + pad2(selection.slot);
      body = installed[selection.slot]
        ? 'FGLT-D installed · select ports or eject the card.'
        : 'Empty slot · drop FGLT-D here to install.';
    } else if (selection.kind === 'card') {
      title = 'FGLT-D · LT' + pad2(selection.slot);
      body = '16 SFP cages · drop modules into empty ports.';
    } else if (selection.kind === 'port') {
      var active = hasSfp(selection.slot, selection.port);
      title = 'Port ' + selection.port + (active ? ' · SFP Active' : ' · Empty');
      body = 'LT' + pad2(selection.slot) + ' · ' + portId(selection.slot, selection.port) +
        (active ? ' · jumper-ready' : ' · insert an SFP');
    }

    card.innerHTML = '<h2>' + title + '</h2><p>' + body + '</p>';

    if (!detail) return;

    if (selection.kind === 'port') {
      var activePort = hasSfp(selection.slot, selection.port);
      var w = portWiring[portId(selection.slot, selection.port)] || {};
      var polish = w.polish || 'UPC';
      detail.innerHTML =
        '<div class="lab-port-sheet">' +
        '<div><span>Status</span><strong>' + (activePort ? 'Active (SFP in)' : 'Empty') + '</strong></div>' +
        '<div><span>Port</span><strong>' + selection.port + ' / 16</strong></div>' +
        '<div><span>Port ID</span><strong>' + portId(selection.slot, selection.port) + '</strong></div>' +
        (activePort
          ? '<div><span>Polish</span><strong>' + polish + '</strong></div>'
          : '') +
        '</div>' +
        (activePort
          ? '<p class="lab-inspector__label">SFP polish</p>' +
            '<div class="lab-polish-toggle" role="group">' +
            '<button type="button" class="lab-polish-btn is-upc' +
            (polish === 'UPC' ? ' is-active' : '') +
            '" data-set-olt-polish="UPC">UPC · Blue</button>' +
            '<button type="button" class="lab-polish-btn is-apc' +
            (polish === 'APC' ? ' is-active' : '') +
            '" data-set-olt-polish="APC">APC · Green</button>' +
            '</div>' +
            '<button type="button" class="lab-eject-btn" data-lab-eject-sfp="1">Remove SFP</button>'
          : '<button type="button" class="lab-install-btn" data-lab-install-sfp="1">Insert SFP into Port ' + selection.port + '</button>');
      detail.hidden = false;
      detail.querySelectorAll('[data-set-olt-polish]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var pid = portId(selection.slot, selection.port);
          if (!portWiring[pid]) return;
          portWiring[pid].polish = btn.getAttribute('data-set-olt-polish');
          rebuildViews();
          selectPort(selection.slot, selection.port);
          setStatus('OLT port polish → ' + portWiring[pid].polish);
        });
      });
      var ej = detail.querySelector('[data-lab-eject-sfp]');
      if (ej) ej.addEventListener('click', function () {
        ejectSfp(selection.slot, selection.port);
      });
      var ins = detail.querySelector('[data-lab-install-sfp]');
      if (ins) ins.addEventListener('click', function () {
        installSfp(null, selection.slot, selection.port);
      });
    } else if (selection.kind === 'card' || (selection.kind === 'slot' && installed[selection.slot])) {
      var slot = selection.slot;
      var ports = '';
      for (var i = 1; i <= PORT_COUNT; i++) {
        var on = hasSfp(slot, i);
        ports += '<button type="button" class="lab-port-chip' +
          (selection.port === i ? ' is-active' : '') +
          (on ? ' is-filled' : '') +
          '" data-lab-port="' + i + '">P' + i + '</button>';
      }
      detail.innerHTML =
        '<p class="lab-inspector__label">SFP ports</p>' +
        '<div class="lab-port-grid">' + ports + '</div>' +
        '<button type="button" class="lab-eject-btn" data-lab-eject="' + slot + '">Eject FGLT-D</button>';
      detail.hidden = false;
      detail.querySelectorAll('[data-lab-port]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectPort(slot, parseInt(btn.getAttribute('data-lab-port'), 10));
        });
      });
      var eject = detail.querySelector('[data-lab-eject]');
      if (eject) eject.addEventListener('click', function () {
        ejectCard(parseInt(eject.getAttribute('data-lab-eject'), 10));
      });
    } else if (selection.kind === 'chassis' && chassisPlaced) {
      detail.innerHTML =
        '<button type="button" class="lab-eject-btn" data-lab-remove-chassis="1">Remove Chassis</button>';
      detail.hidden = false;
      detail.querySelector('[data-lab-remove-chassis]').addEventListener('click', removeChassis);
    } else if (selection.kind === 'lib-chassis' && chassisInLibrary) {
      detail.innerHTML =
        '<button type="button" class="lab-install-btn" data-lab-place-chassis="1">Place FX-16 on Workspace</button>';
      detail.hidden = false;
      detail.querySelector('[data-lab-place-chassis]').addEventListener('click', placeChassis);
    } else if (selection.kind === 'slot' && !installed[selection.slot]) {
      detail.innerHTML =
        '<button type="button" class="lab-install-btn" data-lab-install-slot="' + selection.slot + '">' +
        'Install FGLT-D into LT' + pad2(selection.slot) + '</button>';
      detail.hidden = false;
      detail.querySelector('[data-lab-install-slot]').addEventListener('click', function () {
        installCard(selection.cardId, selection.slot);
      });
    } else {
      detail.hidden = true;
      detail.innerHTML = '';
    }

    syncSelectionUi();
  }

  function syncSelectionUi() {
    if (!el2d) return;
    el2d.querySelectorAll('.lab-fx-slot').forEach(function (node) {
      var s = parseInt(node.getAttribute('data-lab-slot'), 10);
      node.classList.toggle('is-selected', selection.slot === s);
      node.classList.toggle(
        'is-drop-target',
        !!(dragState && dragState.type === 'card' && !installed[s])
      );
    });
    el2d.querySelectorAll('.lab-fx-port').forEach(function (node) {
      var p = parseInt(node.getAttribute('data-lab-sfp'), 10);
      var s = parseInt(node.getAttribute('data-lab-slot'), 10);
      var filled = hasSfp(s, p);
      node.classList.toggle('is-selected',
        selection.kind === 'port' && selection.port === p && selection.slot === s);
      node.classList.toggle('is-active', filled);
      node.classList.toggle('is-empty', !filled);
      node.classList.toggle(
        'is-drop-target',
        !!(dragState && dragState.type === 'sfp' && installed[s] && !filled)
      );
    });

    pickables.forEach(function (mesh) {
      if (!mesh || !mesh.material || !mesh.userData) return;
      var ud = mesh.userData;
      var on = false;
      if (ud.kind === 'slot' && selection.slot === ud.slot) on = true;
      if (ud.kind === 'card' && selection.slot === ud.slot &&
        (selection.kind === 'card' || selection.kind === 'port')) on = true;
      if (ud.kind === 'port' && selection.kind === 'port' &&
        selection.slot === ud.slot && selection.port === ud.port) on = true;
      if (mesh.material.emissive) {
        mesh.material.emissive.setHex(on ? 0x38bdf8 : 0x000000);
        mesh.material.emissiveIntensity = on ? 0.4 : 0;
      }
    });
  }

  /* ─── 2D faceplate with square ports ─── */

  function fgltFaceHtml(slot) {
    var ports = '';
    for (var p = 1; p <= PORT_COUNT; p++) {
      var filled = hasSfp(slot, p);
      var id = portId(slot, p);
      var polish = (portWiring[id] && portWiring[id].polish) || 'UPC';
      var polishClass = filled ? (polish === 'APC' ? ' is-apc' : ' is-upc') : '';
      ports +=
        '<button type="button" class="lab-fx-port' + (filled ? ' is-active' : ' is-empty') +
        polishClass + '" ' +
        'data-lab-sfp="' + p + '" data-lab-slot="' + slot + '" data-lab-port-id="' + id + '" ' +
        'data-lab-drop="sfp" title="Port ' + p + (filled ? ' · SFP · ' + polish : ' · empty') + '">' +
        '<span class="lab-fx-port__cage"></span>' +
        '<span class="lab-fx-port__num">' + p + '</span>' +
        '<span class="lab-fx-port__led' + (filled ? ' is-on' : '') + '"></span>' +
        '</button>';
    }
    return (
      '<div class="lab-fx-card" data-lab-card-slot="' + slot + '">' +
      '<div class="lab-fx-card__leds" title="Status">' +
      '<i class="is-traffic" title="Traffic"></i>' +
      '<i class="is-active" title="Active"></i>' +
      '<i class="is-alarm" title="Alarm"></i>' +
      '<i class="is-fault" title="Fault"></i>' +
      '</div>' +
      '<div class="lab-fx-card__sku">LC-GP16</div>' +
      '<div class="lab-fx-card__ports">' + ports + '</div>' +
      '<div class="lab-fx-card__name">FGLT-D</div>' +
      '</div>'
    );
  }

  function blankingHtml() {
    return '<div class="lab-fx-blank" aria-hidden="true"><span></span><span></span></div>';
  }

  function build2d(host) {
    if (!host) return;
    if (el2d && el2d.parentNode) el2d.parentNode.removeChild(el2d);
    el2d = null;

    /* Blank slate — clean grid, no instructional overlay */
    if (!chassisPlaced) {
      syncSelectionUi();
      return;
    }

    el2d = document.createElement('div');
    el2d.className = 'lab-olt-2d';

    var slotsHtml = '';
    for (var s = 1; s <= SLOT_COUNT; s++) {
      var filled = !!installed[s];
      slotsHtml +=
        '<div class="lab-fx-slot' + (filled ? ' is-filled' : ' is-empty') + '" ' +
        'data-lab-slot="' + s + '" data-lab-drop="lt" title="LT' + pad2(s) + '">' +
        (filled ? fgltFaceHtml(s) : blankingHtml()) +
        '</div>';
    }

    var nums = '';
    for (var n = 1; n <= SLOT_COUNT; n++) {
      nums += '<span>' + pad2(n) + '</span>';
    }

    el2d.innerHTML =
      '<div class="lab-fx-workspace lab-fx-workspace--solo">' +
      '<div class="lab-fx-chassis-frame" data-lab-chassis-frame="1">' +
      '<div class="lab-fx-chassis" data-lab-olt="chassis">' +
      '<div class="lab-fx-comb" data-lab-chassis-drag="1" aria-hidden="true"></div>' +
      '<div class="lab-fx-bay">' + slotsHtml + '</div>' +
      '<div class="lab-fx-numbers">' + nums + '</div>' +
      '<div class="lab-fx-power" data-lab-chassis-drag="1">' +
      '<span class="lab-fx-power__model">7360 ISAM FX-16</span>' +
      '<span class="lab-fx-power__spec">40.5V–72V · 70A</span>' +
      '<span class="lab-fx-power__brand">NOKIA</span>' +
      '</div>' +
      '<div class="lab-fx-fan" data-lab-chassis-drag="1"><span>FAN TRAY</span>' +
      '<span class="lab-fx-fan__leds"><i></i><i class="is-on"></i></span></div>' +
      '</div>' +
      /* Invisible edge/corner hit zones — no visual chrome */
      '<span class="lab-fx-edge lab-fx-edge--n" data-lab-resize="n" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--s" data-lab-resize="s" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--e" data-lab-resize="e" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--w" data-lab-resize="w" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--nw" data-lab-resize="nw" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--ne" data-lab-resize="ne" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--sw" data-lab-resize="sw" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--se" data-lab-resize="se" aria-hidden="true"></span>' +
      '</div></div>';

    host.appendChild(el2d);
    applyChassisLayout();
    bind2dEvents();
    bindChassisMove();
    bindResizeHandles();
    syncSelectionUi();
  }

  function bindChassisMove() {
    if (!el2d || !chassisPlaced) return;
    var frame = el2d.querySelector('.lab-fx-chassis-frame');
    if (!frame) return;

    function startMove(e) {
      if (e.button !== 0) return;
      if (e.target.closest('[data-lab-resize]')) return;
      if (e.target.closest('.lab-fx-slot')) return;
      if (e.target.closest('.lab-fx-port')) return;
      if (!e.target.closest('[data-lab-chassis-drag]')) return;

      e.preventDefault();
      e.stopPropagation();
      selectChassis();

      var zoom = (global.FtthLab && FtthLab.getZoom2d) ? FtthLab.getZoom2d() : 1;
      var startX = e.clientX;
      var startY = e.clientY;
      var originX = chassisX;
      var originY = chassisY;
      var moved = false;
      frame.classList.add('is-dragging');

      function onMove(ev) {
        var dx = (ev.clientX - startX) / zoom;
        var dy = (ev.clientY - startY) / zoom;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        chassisX = originX + dx;
        chassisY = originY + dy;
        applyChassisLayout();
        if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
          FtthLab.notifyLayoutChange();
        }
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        frame.classList.remove('is-dragging');
        if (moved) {
          pushHistory();
          setStatus('Chassis moved on grid');
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange();
          }
        }
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    frame.querySelectorAll('[data-lab-chassis-drag]').forEach(function (el) {
      el.addEventListener('pointerdown', startMove);
    });
  }

  function bindResizeHandles() {
    if (!el2d) return;
    var frame = el2d.querySelector('.lab-fx-chassis-frame');
    if (!frame) return;

    frame.querySelectorAll('[data-lab-resize]').forEach(function (handle) {
      handle.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var mode = handle.getAttribute('data-lab-resize');
        var startX = e.clientX;
        var startY = e.clientY;
        var startScale = chassisScale;
        var startLeft = chassisX;
        var startTop = chassisY;
        var startW = CHASSIS_BASE_W * startScale;
        var zoom = (global.FtthLab && FtthLab.getZoom2d) ? FtthLab.getZoom2d() : 1;
        var startH = frame.getBoundingClientRect().height / zoom;
        var moved = false;

        function onMove(ev) {
          var dx = (ev.clientX - startX) / zoom;
          var dy = (ev.clientY - startY) / zoom;
          var delta = 0;
          if (mode === 'e') delta = dx;
          else if (mode === 'w') delta = -dx;
          else if (mode === 's') delta = dy;
          else if (mode === 'n') delta = -dy;
          else if (mode === 'se') delta = Math.max(dx, dy);
          else if (mode === 'ne') delta = Math.max(dx, -dy);
          else if (mode === 'sw') delta = Math.max(-dx, dy);
          else delta = Math.max(-dx, -dy); /* nw */

          var next = clampChassisScale(startScale + delta / CHASSIS_BASE_W);
          if (Math.abs(next - chassisScale) < 0.001) return;
          moved = true;
          var nextW = CHASSIS_BASE_W * next;
          var nextH = startH * (next / startScale);
          chassisScale = next;

          /* Anchor opposite edge/corner */
          if (mode === 'e' || mode === 's' || mode === 'se') {
            /* top-left fixed */
          } else if (mode === 'w' || mode === 'sw') {
            chassisX = startLeft + (startW - nextW);
          } else if (mode === 'n' || mode === 'ne') {
            chassisY = startTop + (startH - nextH);
          } else {
            chassisX = startLeft + (startW - nextW);
            chassisY = startTop + (startH - nextH);
          }

          applyChassisLayout();
          if (group3d) group3d.scale.setScalar(chassisScale);
        }

        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (moved) {
            pushHistory();
            setStatus('Chassis size · ' + Math.round(chassisScale * 100) + '%');
          }
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
    });
  }

  function bind2dEvents() {
    if (!el2d) return;

    el2d.querySelector('.lab-fx-power').addEventListener('click', selectChassis);

    el2d.querySelectorAll('.lab-fx-slot').forEach(function (slotEl) {
      var slot = parseInt(slotEl.getAttribute('data-lab-slot'), 10);

      slotEl.addEventListener('click', function (e) {
        if (e.target.closest('.lab-fx-port')) return;
        if (installed[slot]) {
          selectCard(slot);
        } else if (selection.kind === 'lib-card') {
          installCard(selection.cardId, slot);
        } else {
          selectSlot(slot);
        }
      });

      slotEl.addEventListener('dragover', function (e) {
        var active = getLabDrag();
        var isCard = (dragState && dragState.type === 'card') || (active && active.kind === 'card');
        if (isCard && !installed[slot]) {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          slotEl.classList.add('is-drop-target');
        }
      });
      slotEl.addEventListener('dragleave', function () {
        slotEl.classList.remove('is-drop-target');
      });
      slotEl.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        slotEl.classList.remove('is-drop-target');
        var active = getLabDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragState && dragState.type);
        if (kind === 'card') {
          var cardId = (e.dataTransfer && e.dataTransfer.getData('text/lab-card-id')) ||
            (active && active.cardId) ||
            (dragState && dragState.cardId);
          if (cardId) installCard(cardId, slot);
        }
        dragState = null;
        endLabDrag();
      });
    });

    el2d.querySelectorAll('.lab-fx-port').forEach(function (btn) {
      var slot = parseInt(btn.getAttribute('data-lab-slot'), 10);
      var port = parseInt(btn.getAttribute('data-lab-sfp'), 10);

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (selection.kind === 'lib-sfp' && !hasSfp(slot, port)) {
          installSfp(selection.sfpId, slot, port);
        } else {
          selectPort(slot, port);
        }
      });

      btn.addEventListener('dragover', function (e) {
        var active = getLabDrag();
        var isSfp = (dragState && dragState.type === 'sfp') || (active && active.kind === 'sfp');
        if (isSfp && !hasSfp(slot, port)) {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          btn.classList.add('is-drop-target');
        }
      });
      btn.addEventListener('dragleave', function () {
        btn.classList.remove('is-drop-target');
      });
      btn.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('is-drop-target');
        var active = getLabDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragState && dragState.type);
        if (kind === 'sfp') {
          var sfpId = (e.dataTransfer && e.dataTransfer.getData('text/lab-sfp-id')) ||
            (active && active.sfpId) ||
            (dragState && dragState.sfpId);
          if (sfpId) installSfp(sfpId, slot, port);
        }
        dragState = null;
        endLabDrag();
      });
    });
  }

  /* ─── 3D ─── */

  function clear3d() {
    if (group3d && group3d.parent) group3d.parent.remove(group3d);
    pickables = [];
    group3d = null;
  }

  function build3d(root) {
    if (!root || typeof THREE === 'undefined') return;
    clear3d();
    root3d = root;

    /* Blank slate — no 3D chassis until user places it */
    if (!chassisPlaced) return;

    group3d = new THREE.Group();
    group3d.name = 'nokia-fx16';
    group3d.position.set(0, 1.15, 0);
    group3d.scale.setScalar(chassisScale);

    var silver = new THREE.MeshStandardMaterial({
      color: 0xc0c6ce, roughness: 0.45, metalness: 0.55,
    });
    var dark = new THREE.MeshStandardMaterial({
      color: 0x3f4650, roughness: 0.55, metalness: 0.35,
    });

    var body = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.55, 1.5), silver);
    body.userData = { kind: 'chassis' };
    group3d.add(body);
    pickables.push(body);

    for (var h = 0; h < 18; h++) {
      var hook = new THREE.Mesh(
        new THREE.TorusGeometry(0.07, 0.015, 6, 10, Math.PI),
        silver
      );
      hook.rotation.z = Math.PI;
      hook.position.set(-2.2 + h * 0.26, 1.42, 0.78);
      group3d.add(hook);
    }

    var power = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.35, 0.08), silver);
    power.position.set(0, -0.95, 0.78);
    power.userData = { kind: 'chassis' };
    group3d.add(power);
    pickables.push(power);

    var fan = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.28, 0.1), dark);
    fan.position.set(0, -1.25, 0.78);
    group3d.add(fan);

    var slotW = 0.28;
    var gap = 0.03;
    var totalW = SLOT_COUNT * slotW + (SLOT_COUNT - 1) * gap;
    var startX = -totalW / 2 + slotW / 2;

    for (var s = 1; s <= SLOT_COUNT; s++) {
      var x = startX + (s - 1) * (slotW + gap);

      if (installed[s]) {
        var cardMat = new THREE.MeshStandardMaterial({
          color: 0xd6d9de, roughness: 0.5, metalness: 0.35,
          emissive: 0x000000, emissiveIntensity: 0,
        });
        var card = new THREE.Mesh(new THREE.BoxGeometry(slotW * 0.92, 1.7, 0.2), cardMat);
        card.position.set(x, 0.15, 0.88);
        card.userData = { kind: 'card', slot: s, card: 'FGLT-D' };
        group3d.add(card);
        pickables.push(card);

        for (var p = 1; p <= PORT_COUNT; p++) {
          var filled = hasSfp(s, p);
          var portMat = new THREE.MeshStandardMaterial({
            color: filled ? 0x0ea5e9 : 0x111827,
            roughness: 0.4,
            metalness: 0.5,
            emissive: 0x000000,
            emissiveIntensity: 0,
          });
          /* square SFP cage */
          var port = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.08), portMat);
          port.position.set(x, 0.88 - (p - 1) * 0.1, 1.02);
          port.userData = {
            kind: 'port',
            slot: s,
            port: p,
            portId: portId(s, p),
            hasSfp: filled,
            wiringReady: true,
          };
          group3d.add(port);
          pickables.push(port);
        }
      } else {
        var blankMat = new THREE.MeshStandardMaterial({
          color: 0xf1f5f9, roughness: 0.7, metalness: 0.1,
          emissive: 0x000000, emissiveIntensity: 0,
        });
        var blank = new THREE.Mesh(new THREE.BoxGeometry(slotW * 0.92, 1.7, 0.08), blankMat);
        blank.position.set(x, 0.15, 0.82);
        blank.userData = { kind: 'slot', slot: s, empty: true };
        group3d.add(blank);
        pickables.push(blank);

        var hit = new THREE.Mesh(
          new THREE.BoxGeometry(slotW, 1.75, 0.15),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        hit.position.set(x, 0.15, 0.9);
        hit.userData = { kind: 'slot', slot: s, empty: true };
        group3d.add(hit);
        pickables.push(hit);
      }
    }

    root.add(group3d);
  }

  function rebuildViews() {
    var host2d = (ctx && ctx.host2d) || (global.FtthLab && FtthLab.getMount2d && FtthLab.getMount2d());
    var host3d = root3d || (ctx && ctx.host3d) || (global.FtthLab && FtthLab.getRoot3d && FtthLab.getRoot3d());
    if (host2d) build2d(host2d);
    if (host3d) build3d(host3d);
    renderToolbox();
    updateInspector();
  }

  function handlePick(ud) {
    if (!ud || !ud.kind) return;
    if (ud.kind === 'chassis') selectChassis();
    else if (ud.kind === 'slot') {
      if (ud.empty) {
        if (selection.kind === 'lib-card') installCard(selection.cardId, ud.slot);
        else selectSlot(ud.slot);
      } else selectSlot(ud.slot);
    } else if (ud.kind === 'card') selectCard(ud.slot);
    else if (ud.kind === 'port') {
      if (selection.kind === 'lib-sfp' && !hasSfp(ud.slot, ud.port)) {
        installSfp(selection.sfpId, ud.slot, ud.port);
      } else {
        selectPort(ud.slot, ud.port);
      }
    }
  }

  function onStageClick(payload) {
    if (!payload || !payload.userData) return;
    handlePick(payload.userData);
  }

  function onViewChange() {
    syncSelectionUi();
  }

  function mount(api) {
    ctx = api || {};
    root3d = ctx.host3d || null;
    resetAssembly();
    bindStageDrop();
    rebuildViews();
    pushHistory();
    updateUndoRedoUi();
    updateInspector();
    setStatus('Blank workspace · scroll to zoom · تراجع / تقدم خطوة · drag FX-16 to begin');
  }

  function getPortWiring(portOrId) {
    if (typeof portOrId === 'number') {
      var slots = occupiedSlots();
      if (!slots.length) return null;
      return portWiring[portId(slots[0], portOrId)] || null;
    }
    return portWiring[portOrId] || null;
  }

  function getPickables() {
    return pickables.slice();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'olt-fx16') return;
    armedToolbox = null;
    if (selection.kind === 'lib-chassis' || selection.kind === 'lib-card' ||
        selection.kind === 'lib-sfp') {
      selection = { kind: 'none', slot: null, port: null, cardId: null, sfpId: null };
    }
    renderToolbox();
  }

  function clearSelection() {
    armedToolbox = null;
    selection = { kind: 'none', slot: null, port: null, cardId: null, sfpId: null };
    renderToolbox();
    syncSelectionUi();
  }

  var tool = {
    id: 'olt-fx16',
    mount: mount,
    onViewChange: onViewChange,
    onStageClick: onStageClick,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    getPortWiring: getPortWiring,
    getPickables: getPickables,
    installCard: installCard,
    ejectCard: ejectCard,
    installSfp: installSfp,
    ejectSfp: ejectSfp,
    selectPort: selectPort,
    selectCard: selectCard,
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('olt-fx16', tool);
      return true;
    }
    return false;
  }

  if (!tryRegister()) {
    document.addEventListener('DOMContentLoaded', function () {
      if (!tryRegister()) {
        var n = 0;
        var t = setInterval(function () {
          if (tryRegister() || ++n > 40) clearInterval(t);
        }, 50);
      }
    });
  }

  global.FtthLabOltFx16 = tool;
})(typeof window !== 'undefined' ? window : this);
