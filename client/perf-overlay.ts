// fpsui: opt-in performance readout (F3 on a map page, play.js).
// Imported on the first F3, so it costs nothing otherwise. Page-side only: it reads
//  - engine presents: the GL owner's per-Present intervals from the engine's shared ring (engine.presentReader(),
//    its own cursor, so telemetry's 10 s drain still sees every frame) -- this is the game's real frame time;
//  - page rAF: the page main thread's requestAnimationFrame cadence (display/compositor + main-thread stalls);
//  - long tasks: PerformanceObserver('longtask') on the page main thread (busy % = long-task ms / window).
// Render-thread busy % needs an engine export that does not exist yet; reported as null.
// A small corner box (pointer-events: none, so it never takes input) refreshes twice a second, and
// window.__perfStats holds the same numbers plus one summary per 5 s window (last 10 min) and session totals.
const WINDOW_MS = 5000, UPDATE_MS = 500, HISTORY = 120, GRAPH_MS = 4000;
const RENDERERS: Record<string, string> = { webgpu: 'WebGPU', 'webgpu-pipeline': 'WebGPU', webgl2: 'WebGL 2' };
type Sample = { t: number; ms: number };
type Frames = { lost: number; intervals: ArrayLike<number>; times: ArrayLike<number> };
type Summary = ReturnType<typeof summarize>;
type View = { present: Summary & { sinceLastMs: number | null }; raf: Summary; longTasks: { busyPct: number } | null; totals: { over33: number }; renderer: string | null };
const now = () => performance.timeOrigin + performance.now(); // epoch ms, the clock of the present ring

function summarize(samples: Sample[], windowMs: number) {
  const n = samples.length;
  if (!n) return { frames: 0, fps: 0, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, over33: 0, over100: 0 };
  const sorted = Float64Array.from(samples, s => s.ms).sort();
  const pick = (q: number) => +sorted[Math.min(n - 1, Math.floor(q * n))].toFixed(1);
  let over33 = 0, over100 = 0;
  for (const s of samples) { if (s.ms > 33) over33++; if (s.ms > 100) over100++; }
  return { frames: n, fps: +(n * 1000 / windowMs).toFixed(1), p50Ms: pick(0.5), p95Ms: pick(0.95), p99Ms: pick(0.99),
    maxMs: +sorted[n - 1].toFixed(1), over33, over100 };
}
function prune(list: Sample[], from: number) { let i = 0; while (i < list.length && list[i].t < from) i++; if (i) list.splice(0, i); }

export function startPerfOverlay() {
  if (globalThis.__perfOverlay) return globalThis.__perfOverlay;
  const presents: Sample[] = [], rafs: Sample[] = [], longTasks: Sample[] = [];
  const totals = { since: new Date().toISOString(), presents: 0, over33: 0, over100: 0, maxMs: 0, lost: 0,
    longTasks: 0, longTaskMs: 0 };
  const history: object[] = [];
  let reader: (() => Frames | null) | null = null, readerEngine: unknown = null, lastRaf = 0, lastPresent = 0, windowStart = now(), windowPresents: Sample[] = [], stopped = false, observer: PerformanceObserver | null = null;

  const rafTick = (t: number) => {
    if (stopped) return;
    if (lastRaf && document.visibilityState === 'visible') rafs.push({ t: performance.timeOrigin + t, ms: t - lastRaf });
    lastRaf = t; requestAnimationFrame(rafTick);
  };
  requestAnimationFrame(rafTick);
  try {
    observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        longTasks.push({ t: performance.timeOrigin + entry.startTime, ms: entry.duration });
        totals.longTasks++; totals.longTaskMs += entry.duration;
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch { /* longtask unsupported (Firefox/Safari): reported as null */ }
  const longTaskSupported = PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false;

  const box = document.createElement('div');
  box.id = 'perf-overlay';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = `<style>
    #perf-overlay { position: fixed; top: 10px; left: 10px; z-index: 2147483647; pointer-events: none; user-select: none; display: grid; gap: 6px;
      padding: 10px 12px; background: rgba(10, 8, 7, .78); border: 1px solid rgba(255, 240, 220, .12); backdrop-filter: blur(6px);
      color: #f3ede2; font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
    #perf-overlay.compact { width: 236px; } #perf-overlay.detail { width: 318px; gap: 4px; }
    #perf-overlay.compact [data-only="detail"], #perf-overlay.detail [data-only="compact"], #perf-overlay [hidden] { display: none; }
    #perf-overlay .fps { display: flex; align-items: baseline; gap: 8px; }
    #perf-overlay .fps b { font: 700 30px/1 ui-monospace, Menlo, Consolas, monospace; }
    #perf-overlay .fps span { font: 600 13px 'Barlow Condensed', 'Arial Narrow', sans-serif; letter-spacing: .14em; color: #b3a998; }
    #perf-overlay .fps em { margin-left: auto; font-style: normal; font-weight: 600; font-size: 15px; }
    #perf-overlay .rows { display: grid; gap: 4px; }
    #perf-overlay .row { display: flex; justify-content: space-between; gap: 14px; color: #b3a998; }
    #perf-overlay .row b { font-weight: 600; color: #f3ede2; }
    #perf-overlay .group { display: grid; gap: 3px; padding-top: 6px; margin-top: 2px; border-top: 1px solid rgba(255, 240, 220, .12); }
    #perf-overlay h4 { margin: 0 0 1px; font: 700 12px 'Barlow Condensed', 'Arial Narrow', sans-serif; letter-spacing: .26em; text-transform: uppercase; color: #7d7468; }
    #perf-overlay .good { color: #7cc47f; } #perf-overlay .warn { color: #e6a83b; } #perf-overlay .bad { color: #e8382b; } #perf-overlay .relay { color: #6aa9e8; }
    #perf-overlay .dot::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
  </style>
  <div class="fps"><b data-k="fps"></b><span>FPS</span><em data-k="ms"></em></div>
  <canvas data-k="graph"></canvas>
  <div class="row" data-only="compact"><span>p95 <b data-k="p95"></b></span><span>saccades <b data-k="hitch"></b></span></div>
  <div class="rows" data-only="detail">
    <div class="row"><span>médiane <b data-k="p50"></b></span><span>p95 <b data-k="p95d"></b></span></div>
    <div class="row"><span>1 % bas <b data-k="low"></b></span><span>pire <b data-k="max"></b></span></div>
    <div class="row"><span>saccades &gt;33 ms <b data-k="h33"></b> · &gt;100 ms <b data-k="h100"></b></span></div>
    <div class="row"><span>depuis le début <b data-k="total"></b></span></div>
    <div class="group"><h4>Moteur</h4>
      <div class="row"><span>rendu <b data-k="renderer"></b></span><span>image <b data-k="size"></b></span></div>
      <div class="row"><span>mémoire <b data-k="mem"></b></span></div>
      <div class="row"><span>page <b data-k="page"></b> FPS</span><span>occupée <b data-k="busy"></b></span></div>
    </div>
    <div class="group"><h4>Son</h4>
      <div class="row"><span>coupures <b data-k="under"></b></span></div>
    </div>
    <div class="group" data-k="net"><h4 data-k="room"></h4>
      <div class="row"><span data-k="link"></span><span>perdus <b data-k="lost"></b></span></div>
      <div class="row"><span>envoyés <b data-k="sent"></b>/s</span><span>reçus <b data-k="recv"></b>/s</span></div>
    </div>
  </div>
  <div class="row bad" data-k="stall"></div>`;
  const el = Object.fromEntries([...box.querySelectorAll<HTMLElement>('[data-k]')].map(node => [node.dataset.k!, node]));
  const graph = el.graph as HTMLCanvasElement;
  let mode = 'compact', netPrev: { t: number; sent: number; received: number } | null = null;

  function drain() {
    const engine = globalThis.five?.engine;
    if (engine !== readerEngine) { readerEngine = engine; reader = engine?.presentReader?.() ?? null; }
    let frames = null;
    try { frames = reader?.(); } catch { frames = null; } // engine stopped/crashed: keep the last numbers
    if (!frames) return;
    totals.lost += frames.lost;
    for (let i = 0; i < frames.intervals.length; ++i) {
      const sample = { t: frames.times[i], ms: frames.intervals[i] };
      presents.push(sample); windowPresents.push(sample);
      totals.presents++; if (sample.ms > 33) totals.over33++; if (sample.ms > 100) totals.over100++;
      if (sample.ms > totals.maxMs) totals.maxMs = +sample.ms.toFixed(1);
      lastPresent = sample.t;
    }
  }
  function update() {
    drain();
    const t = now(), from = t - WINDOW_MS;
    prune(presents, from); prune(rafs, from); prune(longTasks, from);
    const span = Math.min(WINDOW_MS, t - started);
    const longMs = longTasks.reduce((sum, task) => sum + task.ms, 0);
    const state = globalThis.five;
    const stats = {
      updatedAt: new Date().toISOString(), windowMs: Math.round(span), screen: state?.screen ?? null,
      renderer: state?.renderer ?? null, visibility: document.visibilityState, focused: document.hasFocus(),
      fullscreen: Boolean(document.fullscreenElement), pointerLocked: Boolean(document.pointerLockElement),
      dpr: devicePixelRatio, screenSize: `${screen.width}x${screen.height}`,
      present: { ...summarize(presents, span), sinceLastMs: lastPresent ? Math.round(t - lastPresent) : null },
      raf: summarize(rafs, span),
      longTasks: longTaskSupported ? { count: longTasks.length, totalMs: Math.round(longMs),
        busyPct: +(100 * longMs / span).toFixed(1) } : null,
      renderThreadBusyPct: null, // needs an engine-side export (not in this build)
      totals, history };
    if (t - windowStart >= WINDOW_MS) { // one non-overlapping 5 s summary for the history
      history.push({ at: stats.updatedAt, screen: stats.screen, ...summarize(windowPresents, t - windowStart),
        rafP95Ms: stats.raf.p95Ms, longTaskMs: stats.longTasks?.totalMs ?? null });
      if (history.length > HISTORY) history.shift();
      windowStart = t; windowPresents = [];
    }
    globalThis.__perfStats = stats;
    render(stats);
  }
  const num = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '–' : Number(v).toFixed(digits).replace('.', ','));
  const tone = (fps: number) => (fps >= 55 ? 'good' : fps >= 30 ? 'warn' : 'bad');
  const set = (key: string, text: string | number, className?: string) => { el[key].textContent = String(text); if (className !== undefined) el[key].className = className; };
  function draw() {
    const dpr = devicePixelRatio || 1, g = graph.getContext('2d')!, w = graph.width / dpr, h = graph.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const y = (ms: number) => h - Math.min(1, ms / 40) * h;
    g.strokeStyle = 'rgba(255,240,220,.18)'; g.lineWidth = 1; g.setLineDash([3, 3]);
    for (const ms of [16.7, 33.3]) { const line = Math.round(y(ms)) + 0.5; g.beginPath(); g.moveTo(0, line); g.lineTo(w, line); g.stroke(); }
    g.setLineDash([]);
    const from = now() - GRAPH_MS, recent = presents.filter(f => f.t >= from), x = (f: Sample) => (f.t - from) / GRAPH_MS * w;
    if (recent.length > 1) {
      g.beginPath();
      recent.forEach((f, i) => (i ? g.lineTo(x(f), y(f.ms)) : g.moveTo(x(f), y(f.ms))));
      g.strokeStyle = '#7cc47f'; g.lineWidth = 1.5; g.stroke();
      for (const f of recent) if (f.ms > 33) { g.fillStyle = f.ms > 100 ? '#e8382b' : '#e6a83b'; g.fillRect(x(f) - 1.5, y(f.ms), 3, h - y(f.ms)); }
    }
    g.fillStyle = 'rgba(255,240,220,.45)'; g.font = '10px ui-monospace, Menlo, monospace'; g.textBaseline = 'top';
    g.fillText('33', 2, y(33.3) + 2); g.fillText('16', 2, y(16.7) + 2);
  }
  function renderNet() {
    const kb = globalThis.kbnet, query = new URLSearchParams(location.search), room = query.get('room');
    el.net.hidden = !(kb && room);
    if (!kb || !room) return;
    const t = now(), rate = (key: 'sent' | 'received') => (netPrev ? Math.round((kb[key] - netPrev[key]) * 1000 / (t - netPrev.t)) : 0);
    set('sent', rate('sent')); set('recv', rate('received')); set('lost', kb.dropped, kb.dropped ? 'warn' : '');
    netPrev = { t, sent: kb.sent, received: kb.received };
    set('room', `Salon${query.get('private') === '1' ? ' privé' : ''} ${room}`);
    const [text, color] = kb.label === '10.0.0.1' ? ['hôte du salon', 'good'] : kb.relayed ? ['par le relais du serveur', 'relay']
      : kb.linked ? ['liaison directe', 'good'] : ['liaison en cours', 'warn'];
    set('link', text, `dot ${color}`);
  }
  function render(s: View) {
    if (!box.isConnected) (document.body ?? document.documentElement).append(box); // landing replaces <body>
    const p = s.present, r = s.raf, state = globalThis.five, engine = state?.engine;
    set('fps', p.frames ? Math.round(p.fps) : '–', tone(p.fps));
    set('ms', `${num(p.p50Ms)} ms`);
    set('p95', `${num(p.p95Ms)} ms`); set('hitch', p.over33, p.over33 ? 'warn' : '');
    el.stall.hidden = !((p.sinceLastMs ?? 0) > 250);
    el.stall.textContent = `aucune image depuis ${num((p.sinceLastMs ?? 0) / 1000)} s`;
    draw();
    if (mode !== 'detail') return;
    set('p50', `${num(p.p50Ms)} ms`); set('p95d', `${num(p.p95Ms)} ms`);
    set('low', p.p99Ms ? `${Math.round(1000 / p.p99Ms)} FPS` : '–'); set('max', `${num(p.maxMs)} ms`);
    set('h33', p.over33, p.over33 ? 'warn' : ''); set('h100', p.over100, p.over100 ? 'bad' : '');
    set('total', `${s.totals.over33} saccade${s.totals.over33 > 1 ? 's' : ''}`);
    set('renderer', RENDERERS[s.renderer ?? ''] ?? s.renderer ?? '–');
    set('size', state?.canvas ? `${state.canvas.width} × ${state.canvas.height}` : '–');
    const memory = engine?.telemetryMemory?.();
    set('mem', memory ? `${num((memory.wasmBreak ?? memory.wasmBytes) / 2 ** 30, 2)} / ${num(memory.wasmBytes / 2 ** 30, 2)} Go` : '–');
    set('page', r.frames ? Math.round(r.fps) : '–'); set('busy', s.longTasks ? `${num(s.longTasks.busyPct, 0)} %` : '–');
    let audio: { underruns?: number } | null = null;
    try { audio = engine?.audioSnapshot?.(); } catch { /* engine stopped */ }
    set('under', audio?.underruns ?? '–', audio?.underruns ? 'warn' : '');
    renderNet();
  }
  function setMode(next: string) {
    mode = next; box.className = mode; netPrev = null;
    const dpr = devicePixelRatio || 1, [w, h] = mode === 'detail' ? [294, 54] : [212, 34];
    Object.assign(graph, { width: w * dpr, height: h * dpr });
    Object.assign(graph.style, { width: `${w}px`, height: `${h}px` });
    update();
  }
  const started = now();
  const timer = setInterval(update, UPDATE_MS);
  setMode('compact');
  return globalThis.__perfOverlay = { box, update, setMode, get mode() { return mode; }, stop() { stopped = true; observer?.disconnect(); clearInterval(timer); box.remove(); } };
}
