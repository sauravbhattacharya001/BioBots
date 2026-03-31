/**
 * Command Palette — Ctrl+K / Cmd+K to quickly search and navigate all BioBots tools.
 * Self-contained: just add <script src="shared/commandPalette.js"></script> to any page.
 */
(function () {
  'use strict';

  var tools = [
    { name: 'Query Tool', href: 'index.html', icon: '🧬', desc: 'Query bioprint run statistics' },
    { name: 'Data Explorer', href: 'explorer.html', icon: '📊', desc: 'Histograms and scatter plots with regression' },
    { name: 'Data Table', href: 'table.html', icon: '📋', desc: 'Sortable, filterable data browser with CSV export' },
    { name: 'Print Comparison', href: 'compare.html', icon: '🔬', desc: 'Side-by-side comparison of 2–4 prints' },
    { name: 'Quality Control', href: 'quality.html', icon: '🎯', desc: 'Quality grading and optimal parameters' },
    { name: 'Anomaly Detection', href: 'anomaly.html', icon: '🔍', desc: 'Detect outliers and anomalous prints' },
    { name: 'Trends', href: 'trends.html', icon: '📈', desc: 'Temporal trends and run evolution' },
    { name: 'Parameter Optimizer', href: 'optimizer.html', icon: '⚙️', desc: 'Find optimal parameters for any target metric' },
    { name: 'Recipe Builder', href: 'recipe.html', icon: '🧪', desc: 'Build and save bioink recipes' },
    { name: 'API Reference', href: 'api.html', icon: '📡', desc: 'REST API documentation' },
    { name: 'Architecture', href: 'architecture.html', icon: '🏗️', desc: 'System architecture overview' },
    { name: 'Cluster Analysis', href: 'cluster.html', icon: '🔗', desc: 'K-means clustering of print data' },
    { name: 'Correlation Matrix', href: 'correlation.html', icon: '🔗', desc: 'Metric correlations and heatmap' },
    { name: 'SPC Charts', href: 'spc.html', icon: '📊', desc: 'Statistical process control charts' },
    { name: 'Maintenance Tracker', href: 'maintenance.html', icon: '🔧', desc: 'Equipment maintenance scheduling' },
    { name: 'Batch Planner', href: 'batch.html', icon: '📋', desc: 'Plan and organize print batches' },
    { name: 'Setup Guide', href: 'guide.html', icon: '🛠️', desc: 'Getting started guide' },
    { name: 'Material Calculator', href: 'calculator.html', icon: '🧮', desc: 'Bioink material calculations' },
    { name: 'Bioink Mixer', href: 'mixer.html', icon: '🧪', desc: 'Multi-component bioink formulation' },
    { name: 'Compatibility Matrix', href: 'compatibility.html', icon: '🔬', desc: 'Material compatibility checker' },
    { name: 'DOE Analyzer', href: 'doe.html', icon: '🧪', desc: 'Design of experiments analysis' },
    { name: 'Statistics', href: 'stats.html', icon: '📊', desc: 'Descriptive statistics dashboard' },
    { name: 'Protocol Library', href: 'protocol.html', icon: '📋', desc: 'Standard operating procedures' },
    { name: 'Evolution Tracker', href: 'evolution.html', icon: '🧬', desc: 'Track parameter evolution over time' },
    { name: 'Materials Database', href: 'materials.html', icon: '🧪', desc: 'Bioink materials reference' },
    { name: 'Shelf Life', href: 'shelf-life.html', icon: '⏳', desc: 'Material shelf life tracking' },
    { name: 'Rheology Modeler', href: 'rheology.html', icon: '🧪', desc: 'Viscosity and flow modeling' },
    { name: 'Cell Seeding', href: 'seeding.html', icon: '🔬', desc: 'Cell seeding density calculator' },
    { name: 'Timeline', href: 'timeline.html', icon: '📅', desc: 'Print run timeline visualization' },
    { name: 'Growth Curve', href: 'growth.html', icon: '📈', desc: 'Cell growth curve analysis' },
    { name: 'Predictor', href: 'predictor.html', icon: '🔮', desc: 'ML-based outcome prediction' },
    { name: 'Sensitivity Analysis', href: 'sensitivity.html', icon: '🎛️', desc: 'Parameter sensitivity explorer' },
    { name: 'Print Simulator', href: 'simulator.html', icon: '⏱️', desc: 'Simulate print outcomes' },
    { name: 'Troubleshooter', href: 'troubleshooter.html', icon: '🔧', desc: 'Diagnose print failures' },
    { name: 'Lab Timer', href: 'timer.html', icon: '⏱️', desc: 'Multi-channel lab timer' },
    { name: 'Standard Curve', href: 'standard-curve.html', icon: '🧪', desc: 'Standard curve fitting' },
    { name: 'Cost Estimator', href: 'cost.html', icon: '💰', desc: 'Print cost estimation' },
    { name: 'Coverage Report', href: 'coverage.html', icon: '📊', desc: 'Parameter space coverage' },
    { name: 'Failure Diagnostics', href: 'failure.html', icon: '⚠️', desc: 'Failure mode analysis' },
    { name: 'Fingerprint', href: 'fingerprint.html', icon: '🔐', desc: 'Print run fingerprinting' },
    { name: 'Compliance', href: 'compliance.html', icon: '✅', desc: 'Regulatory compliance checker' },
    { name: 'Integrity Check', href: 'integrity.html', icon: '🛡️', desc: 'Data integrity validation' },
    { name: 'Logbook', href: 'logbook.html', icon: '📓', desc: 'Electronic lab notebook' },
    { name: 'Nozzle Advisor', href: 'nozzle.html', icon: '🔩', desc: 'Nozzle selection guide' },
    { name: 'Pareto Analysis', href: 'pareto.html', icon: '📊', desc: 'Pareto charts for quality factors' },
    { name: 'Print Profile', href: 'profile.html', icon: '📄', desc: 'Saved print profiles' },
    { name: 'Print Queue', href: 'queue.html', icon: '📥', desc: 'Print job queue manager' },
    { name: 'Recommender', href: 'recommender.html', icon: '💡', desc: 'Parameter recommendations' },
    { name: 'Report Generator', href: 'report.html', icon: '📑', desc: 'Generate print reports' },
    { name: 'Reproducibility', href: 'reproducibility.html', icon: '🔄', desc: 'Print reproducibility analysis' },
    { name: 'Safety Checklist', href: 'safety-checklist.html', icon: '⚠️', desc: 'Lab safety checklist' },
    { name: 'Sample Tracker', href: 'samples.html', icon: '🏷️', desc: 'Sample inventory tracking' },
    { name: 'Scaffold Designer', href: 'scaffold.html', icon: '🏗️', desc: 'Scaffold geometry calculator' },
    { name: 'Sterilization', href: 'sterilization.html', icon: '🧼', desc: 'Sterilization protocol tracker' },
    { name: 'Toolpath Viewer', href: 'toolpath.html', icon: '🗺️', desc: 'GCode toolpath visualization' },
    { name: 'Run Tracking', href: 'tracking.html', icon: '📍', desc: 'Print run tracking dashboard' },
    { name: 'Waste Tracker', href: 'waste.html', icon: '🗑️', desc: 'Lab waste tracking and reporting' },
    { name: 'Well Plate', href: 'wellplate.html', icon: '🧫', desc: 'Well plate layout planner' },
    { name: 'Yield Analysis', href: 'yield.html', icon: '📈', desc: 'Print yield analysis' },
    { name: 'Maturation Tracker', href: 'maturation.html', icon: '🌱', desc: 'Post-print tissue maturation' }
  ];

  // ── Inject styles ──────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '.cp-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding-top:min(20vh,120px);backdrop-filter:blur(4px);opacity:0;transition:opacity .15s}',
    '.cp-overlay.open{opacity:1}',
    '.cp-box{background:#1e293b;border:1px solid #475569;border-radius:16px;width:min(560px,90vw);max-height:min(480px,70vh);display:flex;flex-direction:column;box-shadow:0 25px 50px rgba(0,0,0,0.5);overflow:hidden}',
    '.cp-input-wrap{display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #334155}',
    '.cp-input-wrap svg{flex-shrink:0;width:20px;height:20px;color:#64748b}',
    '.cp-input{flex:1;background:none;border:none;color:#e2e8f0;font-size:16px;padding:14px 12px;outline:none;font-family:inherit}',
    '.cp-input::placeholder{color:#64748b}',
    '.cp-kbd{font-size:11px;color:#64748b;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:2px 6px;margin-left:8px}',
    '.cp-list{overflow-y:auto;padding:8px;flex:1}',
    '.cp-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;cursor:pointer;color:#cbd5e1;text-decoration:none;transition:background .1s}',
    '.cp-item:hover,.cp-item.active{background:#334155;color:#f1f5f9}',
    '.cp-item-icon{font-size:20px;width:28px;text-align:center;flex-shrink:0}',
    '.cp-item-text{flex:1;min-width:0}',
    '.cp-item-name{font-weight:600;font-size:14px}',
    '.cp-item-desc{font-size:12px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.cp-empty{padding:24px;text-align:center;color:#64748b;font-size:14px}',
    '.cp-hint{padding:8px 16px;border-top:1px solid #334155;display:flex;gap:16px;font-size:11px;color:#64748b}',
    '.cp-hint kbd{background:#0f172a;border:1px solid #334155;border-radius:3px;padding:1px 5px;font-family:inherit;font-size:11px}',
    '.cp-trigger{position:fixed;bottom:20px;right:20px;z-index:99998;background:#1e293b;border:1px solid #475569;border-radius:12px;padding:10px 16px;color:#94a3b8;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:all .2s;box-shadow:0 4px 12px rgba(0,0,0,0.3)}',
    '.cp-trigger:hover{background:#334155;color:#e2e8f0;border-color:#64748b}'
  ].join('\n');
  document.head.appendChild(style);

  // ── Build DOM ──────────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.className = 'cp-overlay';
  overlay.innerHTML = [
    '<div class="cp-box">',
    '  <div class="cp-input-wrap">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
    '    <input class="cp-input" placeholder="Search tools..." autocomplete="off" spellcheck="false" />',
    '    <span class="cp-kbd">ESC</span>',
    '  </div>',
    '  <div class="cp-list"></div>',
    '  <div class="cp-hint">',
    '    <span><kbd>↑↓</kbd> navigate</span>',
    '    <span><kbd>↵</kbd> open</span>',
    '    <span><kbd>esc</kbd> close</span>',
    '  </div>',
    '</div>'
  ].join('');

  // Floating trigger button
  var trigger = document.createElement('div');
  trigger.className = 'cp-trigger';
  trigger.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Search tools <kbd style="background:#0f172a;border:1px solid #334155;border-radius:3px;padding:1px 5px;font-size:11px;margin-left:4px">' + (navigator.platform.indexOf('Mac') > -1 ? '⌘' : 'Ctrl') + '+K</kbd>';

  document.body.appendChild(overlay);
  document.body.appendChild(trigger);

  var input = overlay.querySelector('.cp-input');
  var list = overlay.querySelector('.cp-list');
  var activeIdx = 0;

  // Mark current page
  var curPage = location.pathname.split('/').pop() || 'index.html';

  function render(query) {
    var q = (query || '').toLowerCase().trim();
    var filtered = tools.filter(function (t) {
      if (!q) return true;
      return t.name.toLowerCase().indexOf(q) > -1 ||
             t.desc.toLowerCase().indexOf(q) > -1 ||
             t.icon.indexOf(q) > -1;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="cp-empty">No tools found for "' + q.replace(/</g, '&lt;') + '"</div>';
      return;
    }

    activeIdx = Math.min(activeIdx, filtered.length - 1);

    list.innerHTML = filtered.map(function (t, i) {
      var isCurrent = t.href === curPage;
      var cls = 'cp-item' + (i === activeIdx ? ' active' : '');
      return '<a class="' + cls + '" href="' + t.href + '" data-idx="' + i + '">' +
        '<span class="cp-item-icon">' + t.icon + '</span>' +
        '<div class="cp-item-text">' +
          '<div class="cp-item-name">' + t.name + (isCurrent ? ' <span style="font-size:11px;color:#38bdf8;">(current)</span>' : '') + '</div>' +
          '<div class="cp-item-desc">' + t.desc + '</div>' +
        '</div>' +
      '</a>';
    }).join('');

    // Scroll active into view
    var active = list.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });

    // Store filtered for keyboard nav
    list._filtered = filtered;
  }

  function open() {
    overlay.classList.add('open');
    overlay.style.display = 'flex';
    input.value = '';
    activeIdx = 0;
    render('');
    setTimeout(function () { input.focus(); }, 50);
  }

  function close() {
    overlay.classList.remove('open');
    setTimeout(function () { overlay.style.display = 'none'; }, 150);
  }

  function navigate() {
    var filtered = list._filtered || tools;
    if (filtered[activeIdx]) {
      window.location.href = filtered[activeIdx].href;
    }
  }

  // ── Events ─────────────────────────────────────────────────────
  input.addEventListener('input', function () {
    activeIdx = 0;
    render(input.value);
  });

  input.addEventListener('keydown', function (e) {
    var filtered = list._filtered || tools;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
      render(input.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      render(input.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      navigate();
    } else if (e.key === 'Escape') {
      close();
    }
  });

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });

  trigger.addEventListener('click', open);

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (overlay.classList.contains('open')) {
        close();
      } else {
        open();
      }
    }
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      close();
    }
  });

  // Start hidden
  overlay.style.display = 'none';
})();
