/**
 * Standalone Optical Power Meter training UI.
 * Wavelength · dBm/mW · reference loss · GPON/EPON Pass/Warning/Fail.
 * Optional live bridge from FTTH Lab bench via PowerMeterTrainer.applyLiveReading.
 */
(function (global) {
  'use strict';

  /** ITU-style RX windows used for field-engineer training (ONU / drop). */
  var STANDARDS = {
    gpon: {
      id: 'gpon',
      label: 'GPON (ITU-T G.984)',
      note: 'Class B+ ONU RX · overload −8 · sensitivity −28 dBm',
      failHigh: -7,
      warnHigh: -8,
      passHigh: -8,
      passLow: -27,
      warnLow: -28,
      failLow: -28,
      scaleMin: -35,
      scaleMax: -2,
    },
    epon: {
      id: 'epon',
      label: 'EPON (IEEE 802.3ah PX20)',
      note: 'Typical ONU RX · overload −3 · sensitivity −27 dBm',
      failHigh: -2,
      warnHigh: -3,
      passHigh: -3,
      passLow: -26,
      warnLow: -27,
      failLow: -27,
      scaleMin: -35,
      scaleMax: 0,
    },
  };

  var WAVELENGTH_ORDER = [850, 980, 1310, 1490, 1550, 1625];

  var WAVELENGTH_HINT = {
    850: 'Legacy MM / VCSEL test band',
    980: 'EDFA pump · specialty sensing',
    1310: 'Upstream · ONU → OLT (GPON/EPON TX)',
    1490: 'Downstream · OLT → ONU (GPON primary)',
    1550: 'Long-haul SM · RF overlay / CATV',
    1625: 'Maintenance / OTDR band',
  };

  var state = {
    wavelength: 1490,
    unit: 'dbm',
    powerDbm: NaN,
    referenceDbm: null,
    relativeOn: false,
    standard: 'gpon',
    liveFromBench: false,
    liveLabel: '',
    lastReading: null,
    batteryPct: 92,
    snapshots: [],
    docked: false,
  };

  var SNAP_KEY = 'opm_trainer_snapshots_v1';
  var toastTimer = null;
  var sessionStarted = Date.now();

  function $(id) {
    return document.getElementById(id);
  }

  function dbmToMw(dbm) {
    return Math.pow(10, dbm / 10);
  }

  function mwToDbm(mw) {
    if (!(mw > 0)) return -Infinity;
    return 10 * Math.log10(mw);
  }

  function formatDbm(dbm) {
    if (!isFinite(dbm)) return '——.—';
    var sign = dbm >= 0 ? '+' : '';
    return sign + dbm.toFixed(2);
  }

  function formatMw(mw) {
    if (!isFinite(mw) || mw <= 0) return '——.—';
    if (mw >= 1) return mw.toFixed(3);
    if (mw >= 0.001) return (mw * 1000).toFixed(3) + ' µ';
    return (mw * 1e6).toFixed(2) + ' n';
  }

  function evaluate(dbm, std) {
    if (!isFinite(dbm)) {
      return { status: 'idle', title: 'No reading', detail: '' };
    }
    if (dbm > std.warnHigh) {
      return { status: 'fail', title: 'Overload', detail: '' };
    }
    if (dbm > std.passLow && dbm <= std.passHigh) {
      return { status: 'pass', title: 'In window', detail: '' };
    }
    if (dbm >= std.warnLow && dbm <= std.passLow) {
      return { status: 'warning', title: 'Near sensitivity', detail: '' };
    }
    if (dbm > std.passHigh && dbm <= std.warnHigh) {
      return { status: 'warning', title: 'Near overload', detail: '' };
    }
    return { status: 'fail', title: 'Below sensitivity', detail: '' };
  }

  function needlePercent(dbm, std) {
    if (!isFinite(dbm)) return 50;
    var t = (dbm - std.scaleMin) / (std.scaleMax - std.scaleMin);
    return Math.max(2, Math.min(98, t * 100));
  }

  function syncUnitInput() {
    var input = $('opm-power-input');
    if (!input) return;
    if (state.unit === 'dbm') {
      input.value = isFinite(state.powerDbm) ? String(Math.round(state.powerDbm * 100) / 100) : '';
      input.step = '0.01';
      input.placeholder = 'e.g. -18.50';
    } else {
      var mw = dbmToMw(state.powerDbm);
      input.value = isFinite(mw) ? String(Math.round(mw * 1e6) / 1e6) : '';
      input.step = 'any';
      input.placeholder = 'e.g. 0.014125';
    }
  }

  function readPowerFromInput() {
    var input = $('opm-power-input');
    if (!input) return;
    var raw = parseFloat(input.value);
    if (!isFinite(raw)) {
      state.powerDbm = NaN;
      return;
    }
    if (state.unit === 'dbm') {
      state.powerDbm = raw;
    } else {
      state.powerDbm = mwToDbm(raw);
    }
  }

  function render() {
    var std = STANDARDS[state.standard] || STANDARDS.gpon;
    var dbm = state.docked ? state.powerDbm : NaN;
    var mw = isFinite(dbm) ? dbmToMw(dbm) : NaN;
    var verdict = state.docked ? evaluate(dbm, std) : { status: 'idle', title: 'Dock SC cable', detail: '' };

    var lcdVal = $('opm-lcd-value');
    var lcdUnit = $('opm-lcd-unit');
    var lcdLambda = $('opm-lcd-lambda');
    var lcdMain = $('viavi-lcd-main');
    var softUnit = $('viavi-unit-soft');
    var trainer = $('viavi-trainer');

    if (!state.docked) {
      if (lcdVal) lcdVal.textContent = 'SIGNAL LOW';
      if (lcdUnit) {
        lcdUnit.hidden = true;
        lcdUnit.textContent = '';
      }
      if (lcdMain) lcdMain.classList.add('is-idle');
      if (trainer) {
        trainer.setAttribute('data-docked', '0');
        trainer.setAttribute('data-mismatch', '0');
        trainer.setAttribute('data-warning', '0');
      }
    } else if (!isFinite(dbm) || !(state.lastReading && state.lastReading.source)) {
      if (lcdVal) lcdVal.textContent = 'SIGNAL LOW';
      if (lcdUnit) {
        lcdUnit.hidden = true;
        lcdUnit.textContent = '';
      }
      if (lcdMain) lcdMain.classList.remove('is-idle');
      if (trainer) {
        trainer.setAttribute('data-docked', '1');
        trainer.setAttribute('data-mismatch', state.lastReading && state.lastReading.mismatch ? '1' : '0');
        trainer.setAttribute('data-warning', '1');
      }
    } else if (state.unit === 'mw') {
      if (lcdVal) lcdVal.textContent = formatMw(mw) + (mw >= 1 ? ' mW' : 'W');
      if (lcdUnit) {
        lcdUnit.hidden = true;
        lcdUnit.textContent = '';
      }
      if (lcdMain) lcdMain.classList.remove('is-idle');
      if (trainer) {
        trainer.setAttribute('data-docked', '1');
        trainer.setAttribute('data-mismatch', state.lastReading && state.lastReading.mismatch ? '1' : '0');
        trainer.setAttribute('data-warning', verdict.status === 'warning' ? '1' : '0');
      }
    } else {
      if (lcdVal) lcdVal.textContent = formatDbm(dbm);
      if (lcdUnit) {
        lcdUnit.hidden = false;
        lcdUnit.textContent = 'dBm';
      }
      if (lcdMain) lcdMain.classList.remove('is-idle');
      if (trainer) {
        trainer.setAttribute('data-docked', '1');
        trainer.setAttribute('data-mismatch', state.lastReading && state.lastReading.mismatch ? '1' : '0');
        trainer.setAttribute('data-warning', verdict.status === 'warning' ? '1' : '0');
      }
    }

    if (lcdLambda) lcdLambda.textContent = state.wavelength + ' nm';
    document.querySelectorAll('.viavi__lambda-chip').forEach(function (el) {
      el.textContent = state.wavelength + ' nm';
    });
    var lcdHint = $('opm-lcd-lambda-hint');
    if (lcdHint) lcdHint.textContent = WAVELENGTH_HINT[state.wavelength] || '';
    if (softUnit) softUnit.textContent = state.unit === 'mw' ? 'Pow. [W]' : 'dBm';

    renderLcdSoftBar();

    var convMw = $('opm-stat-mw');
    var lossStat = $('opm-stat-loss');
    if (convMw) convMw.textContent = isFinite(mw) ? formatMw(mw) + (mw >= 1 ? ' mW' : 'W') : '—';
    if (lossStat) {
      if (state.lastReading && isFinite(state.lastReading.lossDb)) {
        lossStat.textContent = state.lastReading.lossDb.toFixed(2) + ' dB';
      } else if (state.referenceDbm != null && isFinite(dbm)) {
        var loss = state.referenceDbm - dbm;
        lossStat.textContent = Math.abs(loss).toFixed(2) + ' dB';
      } else {
        lossStat.textContent = '—';
      }
    }

    var verdictEl = $('opm-verdict');
    if (verdictEl) {
      verdictEl.hidden = !state.docked;
      verdictEl.dataset.status = verdict.status;
      var badge = $('opm-verdict-badge');
      var title = $('opm-verdict-title');
      if (badge) {
        badge.textContent =
          verdict.status === 'pass'
            ? 'PASS'
            : verdict.status === 'warning'
              ? 'WARNING'
              : verdict.status === 'fail'
                ? 'FAIL'
                : 'IDLE';
      }
      if (title) title.textContent = verdict.title;
    }

    var thPass = $('opm-th-pass');
    var thWarn = $('opm-th-warn');
    var thFail = $('opm-th-fail');
    if (thPass) thPass.textContent = std.passLow + '…' + std.passHigh;
    if (thWarn) thWarn.textContent = std.warnLow + '…' + std.passLow;
    if (thFail) thFail.textContent = '<' + std.failLow + ' / >' + std.warnHigh;

    document.querySelectorAll('[data-opm-wave]').forEach(function (btn) {
      btn.classList.toggle('is-active', Number(btn.getAttribute('data-opm-wave')) === state.wavelength);
    });
    document.querySelectorAll('[data-opm-std]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-opm-std') === state.standard);
    });
    document.querySelectorAll('[data-opm-unit]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-opm-unit') === state.unit);
    });

    updateBatteryUi();
    refreshPropertiesPanel();
  }

  function refreshPropertiesPanel() {
    var std = STANDARDS[state.standard] || STANDARDS.gpon;
    var dbm = state.docked ? state.powerDbm : NaN;
    var mw = isFinite(dbm) ? dbmToMw(dbm) : NaN;
    var verdict = state.docked ? evaluate(dbm, std) : { status: 'idle', title: 'Dock SC cable', detail: '' };

    var tele = { lossDb: 0, mismatches: 0 };
    if (global.FtthLab && typeof FtthLab.getNetworkTelemetry === 'function') {
      tele = FtthLab.getNetworkTelemetry() || tele;
    } else if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      tele.lossDb = FtthLab.refreshPowerBudget() || 0;
    }

    var pathStr = '';
    var pathLoss = null;
    if (state.lastReading && state.lastReading.path && state.lastReading.path.length) {
      pathStr = formatPathChain(state.lastReading.path);
      if (isFinite(state.lastReading.lossDb)) pathLoss = state.lastReading.lossDb;
    }
    if (!pathStr) {
      if (tele.lossDb > 0) pathStr = 'Linked topology · probe a port for chain';
      else pathStr = 'No active optical path';
    }
    if (!state.docked) pathStr = 'SIGNAL LOW · dock SC into OLP-38';

    var lossShow = pathLoss != null ? pathLoss : tele.lossDb;

    var verdictWrap = $('opm-props-verdict');
    var verdictBadge = $('opm-props-verdict-badge');
    var verdictTitle = $('opm-props-verdict-title');
    if (verdictWrap) verdictWrap.dataset.status = state.docked ? verdict.status : 'idle';
    if (verdictBadge) {
      verdictBadge.textContent = !state.docked
        ? 'IDLE'
        : verdict.status === 'pass'
          ? 'PASS'
          : verdict.status === 'warning'
            ? 'WARN'
            : verdict.status === 'fail'
              ? 'FAIL'
              : 'IDLE';
    }
    if (verdictTitle) verdictTitle.textContent = state.docked ? verdict.title : 'Dock SC cable';

    var dbmEl = $('opm-props-dbm');
    var readingLabel = $('opm-props-reading-label');
    var altLabel = $('opm-props-alt-label');
    if (readingLabel) {
      readingLabel.textContent = state.unit === 'mw' ? 'Reading (mW)' : 'Reading (dBm)';
    }
    if (altLabel) {
      altLabel.textContent = state.unit === 'mw' ? 'dBm' : 'mW';
    }
    if (dbmEl) {
      if (!state.docked) dbmEl.textContent = 'SIGNAL LOW';
      else if (!isFinite(dbm) || !(state.lastReading && state.lastReading.source)) {
        dbmEl.textContent = 'SIGNAL LOW';
      } else if (state.unit === 'mw') {
        dbmEl.textContent = formatMw(mw) + (mw >= 1 ? ' mW' : 'W');
      } else {
        dbmEl.textContent = formatDbm(dbm) + ' dBm';
      }
    }

    var mwEl = $('opm-props-mw');
    if (mwEl) {
      if (!state.docked || !isFinite(dbm) || !(state.lastReading && state.lastReading.source)) {
        mwEl.textContent = '—';
      } else if (state.unit === 'mw') {
        mwEl.textContent = formatDbm(dbm) + ' dBm';
      } else {
        mwEl.textContent = formatMw(mw) + (mw >= 1 ? ' mW' : 'W');
      }
    }

    var lossEl = $('opm-props-loss');
    if (lossEl) {
      if (state.lastReading && isFinite(state.lastReading.lossDb)) {
        lossEl.textContent = state.lastReading.lossDb.toFixed(2) + ' dB';
      } else if (state.referenceDbm != null && isFinite(dbm)) {
        lossEl.textContent = Math.abs(state.referenceDbm - dbm).toFixed(2) + ' dB';
      } else {
        lossEl.textContent = lossShow > 0 || pathLoss != null
          ? Number(lossShow).toFixed(2) + ' dB'
          : '— dB';
      }
    }

    var waveEl = $('opm-props-wavelength');
    if (waveEl) waveEl.textContent = state.wavelength + ' nm';

    var hintEl = $('opm-props-lambda-hint');
    if (hintEl) hintEl.textContent = WAVELENGTH_HINT[state.wavelength] || '';

    var pathEl = $('opm-props-path');
    if (pathEl) pathEl.textContent = pathStr;

    var alertEl = $('opm-props-alert');
    if (alertEl) {
      alertEl.classList.remove('is-warn', 'is-critical');
      if (tele.mismatches > 0) {
        alertEl.classList.add(tele.mismatches >= 2 ? 'is-critical' : 'is-warn');
        alertEl.textContent =
          tele.mismatches + ' APC/UPC mismatch' + (tele.mismatches > 1 ? 'es' : '');
      } else if (state.lastReading && state.lastReading.mismatch) {
        alertEl.classList.add('is-warn');
        alertEl.textContent = 'Connector polish mismatch on path';
      } else {
        alertEl.textContent = 'Mating OK';
      }
    }

    var snapCount = $('opm-props-snap-count');
    if (snapCount) snapCount.textContent = '(' + state.snapshots.length + ')';
  }

  function renderLambdaCycle() {
    document.querySelectorAll('.viavi__lambda-chip').forEach(function (el) {
      el.textContent = state.wavelength + ' nm';
    });
  }

  function renderLcdSoftBar() {
    var unitLabel = state.unit === 'mw' ? 'Pow. [W]' : 'dBm';
    document.querySelectorAll('.viavi__soft-unit').forEach(function (el) {
      el.textContent = unitLabel;
    });
    renderLambdaCycle();
  }

  function updateViaviClocks(startedAt) {
    var sec = Math.floor((Date.now() - startedAt) / 1000);
    var mm = String(Math.floor(sec / 60)).padStart(2, '0');
    var ss = String(sec % 60).padStart(2, '0');
    var text = mm + ':' + ss;
    var timer = $('viavi-timer');
    if (timer) timer.textContent = text;
    document.querySelectorAll('.viavi__lcd-clock-val').forEach(function (el) {
      el.textContent = text;
    });
  }

  function syncWavelengthToBench() {
    if (global.FtthLab && typeof FtthLab.setOpmWavelength === 'function') {
      FtthLab.setOpmWavelength(state.wavelength);
    }
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    } else if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      FtthLab.refreshPowerBudget();
    }
  }

  function setWavelength(nm) {
    var n = Number(nm);
    if (WAVELENGTH_ORDER.indexOf(n) < 0) return;
    state.wavelength = n;
    syncWavelengthToBench();
    render();
  }

  function cycleWavelength() {
    var ix = WAVELENGTH_ORDER.indexOf(state.wavelength);
    if (ix < 0) ix = WAVELENGTH_ORDER.indexOf(1490);
    state.wavelength = WAVELENGTH_ORDER[(ix + 1) % WAVELENGTH_ORDER.length];
    syncWavelengthToBench();
    render();
  }

  function getWavelength() {
    return state.wavelength;
  }

  function toggleUnit() {
    state.unit = state.unit === 'dbm' ? 'mw' : 'dbm';
    syncUnitInput();
    render();
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
  }

  function toggleStandard() {
    state.standard = state.standard === 'gpon' ? 'epon' : 'gpon';
    render();
  }

  function getUnit() {
    return state.unit;
  }

  function bind() {
    /* Wavelength switching is exclusive to [data-opm-wave-cycle] — see bindStatusBar() */
    document.querySelectorAll('[data-opm-std]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.standard = btn.getAttribute('data-opm-std');
        render();
      });
    });

    document.querySelectorAll('[data-opm-unit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        readPowerFromInput();
        state.unit = btn.getAttribute('data-opm-unit');
        syncUnitInput();
        render();
      });
    });

    var input = $('opm-power-input');
    if (input) {
      input.addEventListener('input', function () {
        state.liveFromBench = false;
        state.liveLabel = '';
        readPowerFromInput();
        render();
      });
    }

    var setRef = $('opm-btn-ref');
    if (setRef) {
      setRef.addEventListener('click', function () {
        readPowerFromInput();
        if (!isFinite(state.powerDbm)) return;
        state.referenceDbm = state.powerDbm;
        state.relativeOn = true;
        render();
      });
    }

    var relBtn = $('opm-btn-rel');
    if (relBtn) {
      relBtn.addEventListener('click', function () {
        if (state.referenceDbm == null) {
          readPowerFromInput();
          if (!isFinite(state.powerDbm)) return;
          state.referenceDbm = state.powerDbm;
        }
        state.relativeOn = !state.relativeOn;
        render();
      });
    }

    var clearRef = $('opm-btn-clear-ref');
    if (clearRef) {
      clearRef.addEventListener('click', function () {
        state.referenceDbm = null;
        state.relativeOn = false;
        render();
      });
    }

    var demoPass = $('opm-demo-pass');
    var demoWarn = $('opm-demo-warn');
    var demoFail = $('opm-demo-fail');
    if (demoPass) {
      demoPass.addEventListener('click', function () {
        state.liveFromBench = false;
        state.unit = 'dbm';
        state.powerDbm = -18.5;
        syncUnitInput();
        render();
      });
    }
    if (demoWarn) {
      demoWarn.addEventListener('click', function () {
        state.liveFromBench = false;
        state.unit = 'dbm';
        state.powerDbm = -27.4;
        syncUnitInput();
        render();
      });
    }
    if (demoFail) {
      demoFail.addEventListener('click', function () {
        state.liveFromBench = false;
        state.unit = 'dbm';
        state.powerDbm = -31.2;
        syncUnitInput();
        render();
      });
    }
  }

  function applyLiveReading(reading) {
    /* Click-probe readings are ignored — docking is required */
    if (!state.docked) return;
    applyDockReading(reading, null);
  }

  function applyDockReading(reading, device) {
    state.lastReading = reading || null;
    state.docked = !!(device && device.docked) || !!(reading && reading.docked);
    if (device && device.docked === false) state.docked = false;
    if (reading && reading.note === 'NO CABLE') state.docked = false;
    if (reading && reading.label === 'UNCONNECTED') state.docked = false;

    if (!state.docked) {
      state.powerDbm = NaN;
      state.liveFromBench = false;
      state.liveLabel = 'UNCONNECTED';
      syncUnitInput();
      render();
      refreshStatusBar();
      return;
    }

    if (reading && isFinite(reading.dBm) && reading.source) {
      state.powerDbm = Number(reading.dBm);
      state.liveFromBench = true;
      state.liveLabel = reading.label || 'OLP-38 dock';
      if (state.batteryPct > 5) state.batteryPct = Math.max(5, state.batteryPct - 0.12);
    } else {
      state.powerDbm = NaN;
      state.liveFromBench = true;
      state.liveLabel = (reading && reading.label) || 'SIGNAL LOW';
    }
    syncUnitInput();
    render();
    refreshStatusBar();
  }

  function formatPathNode(key) {
    if (!key) return '';
    var parts = String(key).split(':');
    var kind = parts[0];
    if (kind === 'olt') {
      var slot = parts[1] || '?';
      var port = parts[2] || '?';
      return 'OLT LT' + (Number(slot) < 10 ? '0' : '') + slot + '/P' + port;
    }
    if (kind === 'spl') {
      var ratio = '';
      if (global.FtthLab && typeof FtthLab.getOpticalSplitters === 'function') {
        var list = FtthLab.getOpticalSplitters() || [];
        var i;
        for (i = 0; i < list.length; i++) {
          if (list[i].id === parts[1]) {
            ratio = list[i].type ? ' ' + String(list[i].type).replace('x', '×') : '';
            break;
          }
        }
      }
      var portId = parts.slice(2).join(':') || '';
      return 'Splitter' + ratio + (portId ? ' · ' + portId : '');
    }
    if (kind === 'cpl') return 'Coupler ' + (parts[2] || '');
    if (kind === 'pcord') return 'Patch';
    if (kind === 'pigtail') return parts[2] === 'tail' ? 'Pigtail fiber' : 'Pigtail';
    if (kind === 'vfl') return 'VFL';
    if (kind === 'opm') return 'OLP-38';
    return key;
  }

  function formatPathChain(path) {
    if (!path || !path.length) return '';
    var labels = [];
    var prev = '';
    var i;
    for (i = 0; i < path.length; i++) {
      var label = formatPathNode(path[i]);
      var short = label.replace(/\s·\s.*/,'');
      if (short === prev && labels.length) continue;
      /* Collapse consecutive Patch hops */
      if (short === 'Patch' && prev === 'Patch') continue;
      labels.push(label);
      prev = short;
    }
    if (state.liveFromBench) labels.push('OLP-38');
    return labels.join(' → ');
  }

  function showToast(msg) {
    var el = $('opm-bar-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-show');
    }, 2200);
  }

  function loadSnapshots() {
    try {
      var raw = global.localStorage && localStorage.getItem(SNAP_KEY);
      state.snapshots = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.snapshots)) state.snapshots = [];
    } catch (err) {
      state.snapshots = [];
    }
  }

  function saveSnapshots() {
    try {
      if (global.localStorage) {
        localStorage.setItem(SNAP_KEY, JSON.stringify(state.snapshots.slice(-40)));
      }
    } catch (err) { /* ignore */ }
  }

  function updateBatteryUi() {
    var pct = Math.round(state.batteryPct);
    var fill = $('opm-bar-batt-fill');
    var label = $('opm-bar-batt-pct');
    var wrap = $('opm-bar-battery');
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = pct + '%';
    if (wrap) {
      wrap.dataset.level = pct <= 20 ? 'low' : pct <= 45 ? 'mid' : 'ok';
      wrap.title = 'Simulated OPM battery · ' + pct + '%';
    }
  }

  function refreshStatusBar() {
    var pathEl = $('opm-bar-path');
    var lossEl = $('opm-bar-loss');
    var alertEl = $('opm-bar-alert');
    var alertText = $('opm-bar-alert-text');
    var snapCount = $('opm-bar-snap-count');

    var tele = { lossDb: 0, mismatches: 0 };
    if (global.FtthLab && typeof FtthLab.getNetworkTelemetry === 'function') {
      tele = FtthLab.getNetworkTelemetry() || tele;
    } else if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      tele.lossDb = FtthLab.refreshPowerBudget() || 0;
    }

    var pathStr = '';
    var pathLoss = null;
    if (state.lastReading && state.lastReading.path && state.lastReading.path.length) {
      pathStr = formatPathChain(state.lastReading.path);
      if (isFinite(state.lastReading.lossDb)) pathLoss = state.lastReading.lossDb;
    }
    if (!pathStr) {
      if (tele.lossDb > 0) pathStr = 'Linked topology · probe a port for chain';
      else pathStr = 'No active optical path';
    }

    if (pathEl) {
      if (!state.docked) pathEl.textContent = 'SIGNAL LOW · dock SC into OLP-38';
      else pathEl.textContent = pathStr;
    }

    var lossShow = pathLoss != null ? pathLoss : tele.lossDb;
    if (lossEl) {
      lossEl.textContent = lossShow > 0 || pathLoss != null
        ? Number(lossShow).toFixed(2) + ' dB'
        : '— dB';
    }

    if (alertEl && alertText) {
      if (tele.mismatches > 0) {
        alertEl.classList.add('is-active');
        alertEl.classList.toggle('is-critical', tele.mismatches >= 2);
        alertText.textContent =
          tele.mismatches + ' APC/UPC mismatch' + (tele.mismatches > 1 ? 'es' : '');
      } else {
        alertEl.classList.remove('is-active', 'is-critical');
        alertText.textContent = 'Mating OK';
      }
    }

    if (snapCount) snapCount.textContent = '(' + state.snapshots.length + ')';
    updateBatteryUi();
    refreshPropertiesPanel();
  }

  function takeSnapshot() {
    var entry = {
      t: new Date().toISOString(),
      dBm: isFinite(state.powerDbm) ? Math.round(state.powerDbm * 100) / 100 : null,
      wavelength: state.wavelength,
      standard: state.standard,
      label: state.liveLabel || 'manual',
      path: state.lastReading && state.lastReading.path
        ? formatPathChain(state.lastReading.path)
        : '',
      lossDb: state.lastReading && isFinite(state.lastReading.lossDb)
        ? state.lastReading.lossDb
        : null,
    };
    state.snapshots.push(entry);
    saveSnapshots();
    refreshStatusBar();
    var msg = entry.dBm != null
      ? 'Logged ' + (entry.dBm >= 0 ? '+' : '') + entry.dBm.toFixed(2) + ' dBm'
      : 'Snapshot saved';
    showToast(msg);
  }

  function clearWorkspace() {
    if (!global.confirm('Clear the fiber bench workspace? Unsaved layout will be lost.')) {
      return;
    }
    try {
      global.sessionStorage && sessionStorage.setItem('opm_bench_cleared', '1');
    } catch (err) { /* ignore */ }
    global.location.reload();
  }

  function bindStatusBar() {
    var snapBtn = $('opm-btn-snapshot') || $('opm-btn-snapshot-bar') || $('opm-props-snapshot');
    var snapBar = $('opm-btn-snapshot-bar');
    var clearBtn = $('opm-btn-clear-ws') || $('opm-props-clear-ws');
    if (snapBtn) snapBtn.addEventListener('click', takeSnapshot);
    if (snapBar && snapBar !== snapBtn) snapBar.addEventListener('click', takeSnapshot);
    if (clearBtn) clearBtn.addEventListener('click', clearWorkspace);

    var modeBtn = $('opm-btn-mode');
    if (modeBtn) {
      modeBtn.addEventListener('click', function () {
        toggleUnit();
      });
    }

    var waveCycle = document.querySelector('[data-opm-wave-cycle]');
    if (waveCycle) {
      waveCycle.addEventListener('click', function () {
        cycleWavelength();
      });
    }

    var stdCycle = document.querySelector('#viavi-trainer [data-opm-std-cycle]');
    if (stdCycle) {
      stdCycle.addEventListener('click', function () {
        toggleStandard();
      });
    }

    var started = sessionStarted;
    setInterval(function () {
      if (state.batteryPct > 8) {
        state.batteryPct = Math.max(8, state.batteryPct - 0.08);
        updateBatteryUi();
      }
      updateViaviClocks(started);
    }, 45000);

    setInterval(function () {
      updateViaviClocks(started);
    }, 1000);

    updateViaviClocks(started);

    refreshStatusBar();
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadSnapshots();
    bind();
    bindStatusBar();
    syncUnitInput();
    syncWavelengthToBench();
    render();
    refreshStatusBar();
  });

  global.PowerMeterTrainer = {
    applyLiveReading: applyLiveReading,
    applyDockReading: applyDockReading,
    refreshStatusBar: refreshStatusBar,
    refreshPropertiesPanel: refreshPropertiesPanel,
    refreshViaviClocks: function () {
      updateViaviClocks(sessionStarted);
    },
    takeSnapshot: takeSnapshot,
    getWavelength: getWavelength,
    setWavelength: setWavelength,
    cycleWavelength: cycleWavelength,
    getWavelengthOrder: function () { return WAVELENGTH_ORDER.slice(); },
    getWavelengthHint: function (nm) { return WAVELENGTH_HINT[nm] || ''; },
    getUnit: getUnit,
    toggleUnit: toggleUnit,
    toggleStandard: toggleStandard,
    getState: function () {
      return {
        powerDbm: state.powerDbm,
        wavelength: state.wavelength,
        unit: state.unit,
        standard: state.standard,
        liveFromBench: state.liveFromBench,
        docked: state.docked,
        batteryPct: state.batteryPct,
        snapshots: state.snapshots.length,
      };
    },
  };
})(typeof window !== 'undefined' ? window : this);
