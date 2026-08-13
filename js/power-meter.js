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

  var WAVELENGTH_HINT = {
    1310: 'Upstream · ONU → OLT (GPON/EPON TX)',
    1490: 'Downstream · OLT → ONU (GPON primary)',
    1550: 'RF overlay / CATV · or long-haul test',
  };

  var state = {
    wavelength: 1490,
    unit: 'dbm',
    powerDbm: -18.5,
    referenceDbm: null,
    relativeOn: false,
    standard: 'gpon',
    liveFromBench: false,
    liveLabel: '',
  };

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
    var dbm = state.powerDbm;
    var mw = isFinite(dbm) ? dbmToMw(dbm) : NaN;
    var verdict = evaluate(dbm, std);

    var lcdVal = $('opm-lcd-value');
    var lcdUnit = $('opm-lcd-unit');
    var lcdLambda = $('opm-lcd-lambda');
    var lcdMw = $('opm-lcd-mw');
    var lcdRel = $('opm-lcd-rel');

    if (lcdVal) lcdVal.textContent = formatDbm(dbm);
    if (lcdUnit) lcdUnit.textContent = 'dBm';
    if (lcdLambda) lcdLambda.textContent = 'λ ' + state.wavelength + ' nm';
    if (lcdMw) lcdMw.textContent = isFinite(mw) ? formatMw(mw) + (mw >= 1 ? ' mW' : 'W') : '— mW';

    if (lcdRel) {
      if (state.relativeOn && state.referenceDbm != null && isFinite(dbm)) {
        var rel = dbm - state.referenceDbm;
        lcdRel.hidden = false;
        lcdRel.textContent =
          'REL ' + (rel >= 0 ? '+' : '') + rel.toFixed(2) + ' dB  (ref ' + formatDbm(state.referenceDbm) + ' dBm)';
      } else {
        lcdRel.hidden = true;
        lcdRel.textContent = '';
      }
    }

    var waveHint = $('opm-wave-hint');
    if (waveHint) waveHint.textContent = WAVELENGTH_HINT[state.wavelength] || '';

    var stdNote = $('opm-std-note');
    if (stdNote) stdNote.textContent = std.note;

    var convMw = $('opm-stat-mw');
    var lossStat = $('opm-stat-loss');
    if (convMw) convMw.textContent = isFinite(mw) ? formatMw(mw) + (mw >= 1 ? ' mW' : 'W') : '—';
    if (lossStat) {
      if (state.referenceDbm != null && isFinite(dbm)) {
        var loss = state.referenceDbm - dbm;
        lossStat.textContent = (loss >= 0 ? '' : '−') + Math.abs(loss).toFixed(2) + ' dB';
      } else {
        lossStat.textContent = '—';
      }
    }

    var verdictEl = $('opm-verdict');
    if (verdictEl) {
      verdictEl.dataset.status = verdict.status;
      var badge = $('opm-verdict-badge');
      var title = $('opm-verdict-title');
      var detail = $('opm-verdict-detail');
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
      if (detail) detail.textContent = verdict.detail;
    }

    var needle = $('opm-meter-needle');
    if (needle) needle.style.left = needlePercent(dbm, std) + '%';

    var scaleMin = $('opm-scale-min');
    var scaleMax = $('opm-scale-max');
    if (scaleMin) scaleMin.textContent = std.scaleMin + ' dBm';
    if (scaleMax) scaleMax.textContent = std.scaleMax + ' dBm';

    var thPass = $('opm-th-pass');
    var thWarn = $('opm-th-warn');
    var thFail = $('opm-th-fail');
    if (thPass) thPass.textContent = std.passLow + '…' + std.passHigh;
    if (thWarn) thWarn.textContent = std.warnLow + '…' + std.passLow;
    if (thFail) thFail.textContent = '<' + std.failLow + ' / >' + std.warnHigh;

    var liveBadge = $('opm-live-badge');
    if (liveBadge) {
      liveBadge.hidden = !state.liveFromBench;
      if (state.liveFromBench && state.liveLabel) {
        liveBadge.title = state.liveLabel;
      }
    }

    document.querySelectorAll('[data-opm-wave]').forEach(function (btn) {
      btn.classList.toggle('is-active', Number(btn.getAttribute('data-opm-wave')) === state.wavelength);
    });
    document.querySelectorAll('[data-opm-std]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-opm-std') === state.standard);
    });
    document.querySelectorAll('[data-opm-unit]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-opm-unit') === state.unit);
    });

    var relBtn = $('opm-btn-rel');
    if (relBtn) {
      relBtn.classList.toggle('opm-btn--primary', state.relativeOn);
      relBtn.setAttribute('aria-pressed', state.relativeOn ? 'true' : 'false');
      relBtn.textContent = state.relativeOn ? 'REL On' : 'REL Off';
    }
  }

  function bind() {
    document.querySelectorAll('[data-opm-wave]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.wavelength = Number(btn.getAttribute('data-opm-wave'));
        render();
      });
    });

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
    if (!reading) return;
    if (!isFinite(reading.dBm)) {
      state.liveFromBench = false;
      state.liveLabel = reading.note || reading.label || '';
      render();
      return;
    }
    state.unit = 'dbm';
    state.powerDbm = Number(reading.dBm);
    state.liveFromBench = true;
    state.liveLabel = reading.label || (reading.probe && reading.probe.label) || 'Bench probe';
    syncUnitInput();
    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    syncUnitInput();
    render();
  });

  global.PowerMeterTrainer = {
    applyLiveReading: applyLiveReading,
    getState: function () {
      return {
        powerDbm: state.powerDbm,
        wavelength: state.wavelength,
        standard: state.standard,
        liveFromBench: state.liveFromBench,
      };
    },
  };
})(typeof window !== 'undefined' ? window : this);
