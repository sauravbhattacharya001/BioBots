/**
 * BioBots Lab Shift Handoff — Autonomous Shift Summary Generator
 * Aggregates experiment, equipment, reagent, and task data to produce
 * structured handoff reports for incoming lab teams.
 */

'use strict';

const ShiftHandoff = (() => {
  const SHIFTS = [
    { name: 'Night', start: 0, end: 8, color: '#6366f1' },
    { name: 'Day', start: 8, end: 16, color: '#38bdf8' },
    { name: 'Swing', start: 16, end: 24, color: '#f59e0b' }
  ];

  function generateExperiments() {
    const names = [
      'Cartilage Scaffold Print #47', 'Vascular Network Bioprint R3',
      'Skin Graft Layer Assembly', 'Bone Matrix Deposition T12',
      'Neural Conduit Fabrication', 'Cardiac Patch Series B',
      'Liver Organoid Culture P8', 'Corneal Stroma Print #21'
    ];
    const statuses = ['running', 'paused', 'needs-attention', 'completed'];
    const printers = ['BioBot-1', 'BioBot-2', 'BioBot-3', 'CellInk-Pro'];
    return names.map((name, i) => ({
      id: `EXP-${String(i + 1).padStart(3, '0')}`,
      name,
      status: statuses[i % statuses.length],
      printer: printers[i % printers.length],
      startedAt: Date.now() - Math.random() * 24 * 3600000,
      progress: Math.round(Math.random() * 100),
      nextCheckpoint: Date.now() + Math.random() * 8 * 3600000,
      notes: ''
    }));
  }

  function generateEquipment() {
    return [
      { id: 'EQ-1', name: 'BioBot-1', type: 'printer', status: 'in-use', hours: 14 },
      { id: 'EQ-2', name: 'BioBot-2', type: 'printer', status: 'available', hours: 0 },
      { id: 'EQ-3', name: 'BioBot-3', type: 'printer', status: 'maintenance', hours: 0 },
      { id: 'EQ-4', name: 'CellInk-Pro', type: 'printer', status: 'in-use', hours: 6 },
      { id: 'EQ-5', name: 'Incubator A', type: 'incubator', status: 'in-use', hours: 72 },
      { id: 'EQ-6', name: 'Incubator B', type: 'incubator', status: 'available', hours: 0 },
      { id: 'EQ-7', name: 'Centrifuge-1', type: 'centrifuge', status: 'available', hours: 0 },
      { id: 'EQ-8', name: 'Laminar Hood 1', type: 'hood', status: 'in-use', hours: 3 },
      { id: 'EQ-9', name: 'UV Crosslinker', type: 'crosslinker', status: 'available', hours: 0 },
      { id: 'EQ-10', name: 'Microscope Bay', type: 'imaging', status: 'in-use', hours: 1 }
    ];
  }

  function generateReagents() {
    return [
      { name: 'GelMA 10%', stock: 2, unit: 'vials', expiry: Date.now() + 3 * 86400000, opened: Date.now() - 5 * 86400000, alert: 'expiring-soon' },
      { name: 'Collagen Type I', stock: 8, unit: 'mL', expiry: Date.now() + 30 * 86400000, opened: null, alert: null },
      { name: 'DMEM + FBS', stock: 50, unit: 'mL', expiry: Date.now() + 14 * 86400000, opened: Date.now() - 2 * 86400000, alert: 'recently-opened' },
      { name: 'Alginate 2%', stock: 1, unit: 'cartridge', expiry: Date.now() + 60 * 86400000, opened: null, alert: 'low-stock' },
      { name: 'Photoinitiator LAP', stock: 0.5, unit: 'g', expiry: Date.now() + 7 * 86400000, opened: Date.now() - 1 * 86400000, alert: 'low-stock' },
      { name: 'PBS 1X', stock: 500, unit: 'mL', expiry: Date.now() + 90 * 86400000, opened: null, alert: null },
      { name: 'Trypsin-EDTA', stock: 15, unit: 'mL', expiry: Date.now() + 2 * 86400000, opened: Date.now() - 7 * 86400000, alert: 'expiring-soon' },
      { name: 'Fibrinogen', stock: 3, unit: 'mg', expiry: Date.now() + 45 * 86400000, opened: null, alert: null }
    ];
  }

  function generateTasks() {
    return [
      { id: 'T1', title: 'Replace BioBot-3 printhead gasket', priority: 'critical', est: '45 min', due: Date.now() + 2 * 3600000, assignee: 'Incoming' },
      { id: 'T2', title: 'Monitor Cartilage Scaffold checkpoint (layer 200)', priority: 'high', est: '10 min', due: Date.now() + 1.5 * 3600000, assignee: 'Incoming' },
      { id: 'T3', title: 'Restock Alginate 2% cartridges from cold storage', priority: 'high', est: '15 min', due: Date.now() + 4 * 3600000, assignee: 'Incoming' },
      { id: 'T4', title: 'Validate Trypsin-EDTA before cell passage', priority: 'medium', est: '20 min', due: Date.now() + 5 * 3600000, assignee: 'Incoming' },
      { id: 'T5', title: 'Clean laminar hood after scaffold prep', priority: 'medium', est: '25 min', due: Date.now() + 6 * 3600000, assignee: 'Incoming' },
      { id: 'T6', title: 'Upload print session logs to LIMS', priority: 'low', est: '10 min', due: Date.now() + 8 * 3600000, assignee: 'Incoming' },
      { id: 'T7', title: 'Calibrate UV crosslinker intensity', priority: 'low', est: '30 min', due: Date.now() + 10 * 3600000, assignee: 'Incoming' }
    ];
  }

  function generateEnvironment() {
    return [
      { zone: 'Print Bay 1', temp: 22.3, humidity: 45, co2: null, flag: null },
      { zone: 'Print Bay 2', temp: 24.1, humidity: 52, co2: null, flag: 'temp-high' },
      { zone: 'Incubator A', temp: 37.0, humidity: 95, co2: 5.0, flag: null },
      { zone: 'Incubator B', temp: 36.8, humidity: 93, co2: 5.1, flag: null },
      { zone: 'Cold Storage', temp: 4.2, humidity: 30, co2: null, flag: null },
      { zone: 'Laminar Hood Area', temp: 21.5, humidity: 40, co2: null, flag: null }
    ];
  }

  function generateIncidents() {
    const now = Date.now();
    return [
      { time: now - 2 * 3600000, severity: 'warning', msg: 'Print Bay 2 temperature exceeded 24°C for 15 min — HVAC cycled' },
      { time: now - 5 * 3600000, severity: 'info', msg: 'BioBot-1 paused for nozzle clean (routine) — resumed after 8 min' },
      { time: now - 7 * 3600000, severity: 'critical', msg: 'BioBot-3 printhead clog detected — print aborted, gasket replacement required' }
    ];
  }

  function generateRecommendations(experiments, equipment, reagents) {
    const recs = [];
    experiments.forEach(e => {
      if (e.status === 'running' && e.nextCheckpoint - Date.now() < 3 * 3600000) {
        const hrs = ((e.nextCheckpoint - Date.now()) / 3600000).toFixed(1);
        recs.push({ type: 'experiment', priority: 'high', msg: `${e.name} reaches checkpoint in ~${hrs}h — incoming team should monitor` });
      }
    });
    equipment.forEach(eq => {
      if (eq.status === 'in-use' && eq.hours > 12) {
        recs.push({ type: 'equipment', priority: 'medium', msg: `${eq.name} has been running ${eq.hours}h — consider scheduling maintenance window` });
      }
    });
    reagents.forEach(r => {
      if (r.opened && (Date.now() - r.opened) > 3 * 86400000) {
        const days = Math.round((Date.now() - r.opened) / 86400000);
        recs.push({ type: 'reagent', priority: 'medium', msg: `${r.name} was opened ${days} days ago — verify integrity before use` });
      }
      if (r.alert === 'expiring-soon') {
        const days = Math.round((r.expiry - Date.now()) / 86400000);
        recs.push({ type: 'reagent', priority: 'high', msg: `${r.name} expires in ${days} day(s) — plan usage or reorder` });
      }
    });
    const env = generateEnvironment();
    env.forEach(z => {
      if (z.flag) recs.push({ type: 'environment', priority: 'medium', msg: `Temperature anomaly in ${z.zone} — check HVAC` });
    });
    return recs.sort((a, b) => {
      const p = { critical: 0, high: 1, medium: 2, low: 3 };
      return (p[a.priority] || 3) - (p[b.priority] || 3);
    });
  }

  function generateChecklist(equipment, experiments, reagents) {
    const items = [];
    equipment.filter(e => e.status === 'in-use').forEach(e => {
      items.push({ id: `chk-${e.id}`, text: `Verify ${e.name} status and log readings`, category: 'Equipment', checked: false });
    });
    experiments.filter(e => e.status === 'running').forEach(e => {
      items.push({ id: `chk-${e.id}`, text: `Confirm ${e.name} is progressing (${e.progress}%)`, category: 'Experiments', checked: false });
    });
    reagents.filter(r => r.alert).forEach(r => {
      items.push({ id: `chk-reagent-${r.name}`, text: `Check ${r.name} — ${r.alert.replace('-', ' ')}`, category: 'Reagents', checked: false });
    });
    items.push({ id: 'chk-waste', text: 'Verify biohazard waste bins are below threshold', category: 'Safety', checked: false });
    items.push({ id: 'chk-log', text: 'Sign shift log and note any deviations', category: 'Admin', checked: false });
    return items;
  }

  function getCurrentShift() {
    const hour = new Date().getHours();
    return SHIFTS.find(s => hour >= s.start && hour < s.end) || SHIFTS[0];
  }

  function generateTimelineEvents(experiments, equipment) {
    const events = [];
    const now = Date.now();
    equipment.filter(e => e.status === 'in-use').forEach(e => {
      const start = now - e.hours * 3600000;
      events.push({ label: e.name, start, end: now, type: 'equipment', color: e.type === 'printer' ? '#38bdf8' : '#4ade80' });
    });
    experiments.filter(e => e.status === 'running').forEach(e => {
      events.push({ label: `⚑ ${e.name} checkpoint`, time: e.nextCheckpoint, type: 'milestone' });
    });
    return events;
  }

  function renderTimeline(canvas, events) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.parentElement.clientWidth;
    const H = canvas.height = 260;
    const pad = { top: 40, bottom: 30, left: 120, right: 20 };
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const timeToX = t => pad.left + ((t - dayStart.getTime()) / (24 * 3600000)) * (W - pad.left - pad.right);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);

    SHIFTS.forEach(s => {
      const x1 = timeToX(dayStart.getTime() + s.start * 3600000);
      const x2 = timeToX(dayStart.getTime() + s.end * 3600000);
      ctx.fillStyle = s.color + '15';
      ctx.fillRect(x1, pad.top, x2 - x1, H - pad.top - pad.bottom);
      ctx.fillStyle = s.color;
      ctx.font = '11px sans-serif';
      ctx.fillText(s.name, x1 + 4, pad.top - 6);
    });

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    for (let h = 0; h <= 24; h += 3) {
      const x = timeToX(dayStart.getTime() + h * 3600000);
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
      ctx.fillText(`${String(h).padStart(2, '0')}:00`, x - 14, H - pad.bottom + 14);
    }

    const nowX = timeToX(Date.now());
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(nowX, pad.top); ctx.lineTo(nowX, H - pad.bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('NOW', nowX - 12, pad.top - 6);

    const equipEvents = events.filter(e => e.type === 'equipment');
    const rowH = Math.min(22, (H - pad.top - pad.bottom - 30) / Math.max(equipEvents.length, 1));
    equipEvents.forEach((ev, i) => {
      const y = pad.top + 10 + i * rowH;
      const x1 = Math.max(pad.left, timeToX(ev.start));
      const x2 = Math.min(W - pad.right, timeToX(ev.end));
      ctx.fillStyle = ev.color + '99';
      ctx.fillRect(x1, y, Math.max(x2 - x1, 2), rowH - 4);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px sans-serif';
      ctx.fillText(ev.label, 4, y + rowH - 6);
    });

    const milestones = events.filter(e => e.type === 'milestone');
    milestones.forEach(m => {
      const x = timeToX(m.time);
      if (x < pad.left || x > W - pad.right) return;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.moveTo(x, H - pad.bottom - 10); ctx.lineTo(x - 5, H - pad.bottom); ctx.lineTo(x + 5, H - pad.bottom); ctx.fill();
    });
  }

  const STORAGE_KEY = 'biobots_shift_handoffs';
  function saveHandoff(handoff) {
    const history = getHistory();
    history.unshift(handoff);
    if (history.length > 50) history.length = 50;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }
  function clearHistory() { localStorage.removeItem(STORAGE_KEY); }

  function exportMarkdown(data) {
    const lines = [`# Shift Handoff Report`, `**Generated:** ${new Date(data.timestamp).toLocaleString()}`, `**Outgoing Shift:** ${data.shift.name}`, ''];
    lines.push('## Active Experiments');
    data.experiments.filter(e => e.status !== 'completed').forEach(e => lines.push(`- [${e.status.toUpperCase()}] ${e.name} (${e.progress}%) on ${e.printer}`));
    lines.push('', '## Equipment Status');
    data.equipment.forEach(e => lines.push(`- ${e.name}: ${e.status}${e.hours > 0 ? ` (${e.hours}h)` : ''}`));
    lines.push('', '## Reagent Alerts');
    data.reagents.filter(r => r.alert).forEach(r => lines.push(`- ⚠️ ${r.name}: ${r.alert.replace('-', ' ')} (stock: ${r.stock} ${r.unit})`));
    lines.push('', '## Priority Tasks');
    data.tasks.forEach(t => lines.push(`- [${t.priority.toUpperCase()}] ${t.title} (~${t.est})`));
    lines.push('', '## Recommendations');
    data.recommendations.forEach(r => lines.push(`- ${r.msg}`));
    lines.push('', '## Incidents (Last 8h)');
    data.incidents.forEach(inc => lines.push(`- [${inc.severity}] ${new Date(inc.time).toLocaleTimeString()} — ${inc.msg}`));
    return lines.join('\n');
  }

  function exportJSON(data) { return JSON.stringify(data, null, 2); }

  function buildHandoff() {
    const experiments = generateExperiments();
    const equipment = generateEquipment();
    const reagents = generateReagents();
    const tasks = generateTasks();
    const environment = generateEnvironment();
    const incidents = generateIncidents();
    const recommendations = generateRecommendations(experiments, equipment, reagents);
    const checklist = generateChecklist(equipment, experiments, reagents);
    const shift = getCurrentShift();
    return { timestamp: Date.now(), shift, experiments, equipment, reagents, tasks, environment, incidents, recommendations, checklist };
  }

  return { SHIFTS, buildHandoff, renderTimeline, generateTimelineEvents, saveHandoff, getHistory, clearHistory, exportMarkdown, exportJSON, getCurrentShift };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = ShiftHandoff; }
