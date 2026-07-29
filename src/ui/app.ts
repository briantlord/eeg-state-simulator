/**
 * The artifact.
 *
 * "THE TIER 0 SHIPPING TEST: if everything except the scrolling trace and the filter
 * demonstration were deleted on the last day, the artifact would still make its point."
 *
 * Two loops, at different rates, on purpose:
 *
 *   The TRACE redraws every frame, because it scrolls.
 *   The OBSERVABLES recompute at `analysis_update` (1 Hz), because they cost real time — the
 *   LZ parse alone is ~29 ms, and running it per frame would drop one visibly every second.
 *   Build Plan §8: "All performance risk is in the analysis path, and one algorithm dominates
 *   it."
 */
import '../tokens/tokens.css';
import { ALL_CHANNELS } from '../core/generators/projection.ts';
import { STATE_IDS, STATE_LABELS, type StateId } from '../core/types/state.ts';
import { applyHighpass, ringingDemo, type FilterType } from '../core/filters/hpf.ts';
import { couplingReadout } from '../analysis/coupling.ts';
import { broadbandExponent, narrowbandExponent } from '../analysis/psd.ts';
import { lempelZiv } from '../analysis/lz.ts';
import { formatExponent } from '../core/types/exponent.ts';
import { Rng } from '../core/rng/xoshiro128pp.ts';
import { drawTrace } from '../render/trace.ts';
import { SignalStream } from './stream.ts';
import { scalarValue, enumValue, inventedKeys, GENERATOR_VERSION } from '../core/registry.ts';

const FS = scalarValue('fs');
const ANALYSIS_HZ = scalarValue('analysis_update');

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ui = {
  state: 'n3' as StateId,
  seed: scalarValue('snr_calibration_seed'),
  hpf: enumValue('hpf_options')[0] as number,
  ftype: 'zeroPhase' as FilterType,
  windowS: 30,
  sensitivity: scalarValue('display_sensitivity'),
  running: true,
  /** Scalp only, or scalp plus the mastoid references the AASM criterion needs. */
  showReference: false,
};

let stream = new SignalStream({ seed: ui.seed, state: ui.state, chiModulation: true });

/** Filtered copy of the current segment, rebuilt only when the filter or segment changes. */
let filtered: Float64Array[] = [];
let filteredKey = '';

function ensureFiltered(): Float64Array[] {
  const key = `${ui.hpf}|${ui.ftype}|${stream.elapsedS - stream.positionS}`;
  if (key !== filteredKey) {
    filtered = stream.channels.map((c) => applyHighpass(c, ui.hpf, ui.ftype, FS));
    filteredKey = key;
  }
  return filtered;
}

function visibleChannels(all: readonly Float64Array[]): {
  data: Float64Array[];
  labels: string[];
} {
  const n = ui.showReference ? ALL_CHANNELS.length : ALL_CHANNELS.length - 2;
  return {
    data: all.slice(0, n) as Float64Array[],
    labels: ALL_CHANNELS.slice(0, n) as string[],
  };
}

// --------------------------------------------------------------------- trace

function drawFrame(): void {
  const all = ensureFiltered();
  const { data, labels } = visibleChannels(all);

  // The playhead sits at the RIGHT edge, as on a paper chart: new signal arrives at the pen
  // and older signal scrolls left out of view.
  const tEnd = stream.positionS;
  const tStart = Math.max(0, tEnd - ui.windowS);

  drawTrace($<HTMLCanvasElement>('trace'), {
    channels: data,
    labels,
    fs: FS,
    sensitivityUvPerMm: ui.sensitivity,
    pxPerMm: scalarValue('display_px_per_mm'),
    events: stream.events.map((e) => ({
      onset: e.onset,
      duration: e.duration,
      type: e.type,
    })),
    windowS: ui.windowS,
    tOffsetS: tStart,
  });

  $('clock').textContent =
    `t = ${stream.elapsedS.toFixed(1)} s   ·   ${ui.windowS} s window   ·   ` +
    `${ui.sensitivity} µV/mm   ·   ${labels.length} ch`;
}

/** Exposed so a non-compositing environment can step the display deterministically. */
(globalThis as Record<string, unknown>)['__eegsim'] = {
  step: (dt: number) => {
    stream.advance(dt);
    updateObservables();
  },
  position: () => stream.positionS,
};

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (ui.running) stream.advance(dt);
  drawFrame();
  requestAnimationFrame(loop);
}

// -------------------------------------------------------------- observables

function updateObservables(): void {
  const all = ensureFiltered();
  // Analyse the window on screen, not the whole buffer: the readout should describe what the
  // reader is looking at.
  const tEnd = stream.positionS;
  const tStart = Math.max(0, tEnd - ui.windowS);
  const a = Math.round(tStart * FS);
  const b = Math.round(tEnd * FS);
  if (b - a < FS * 2) return;

  const pz = all[ALL_CHANNELS.indexOf('Pz')]!.subarray(a, b);

  // COUPLING IS MEASURED OVER THE WHOLE BUFFER, NOT THE VISIBLE WINDOW.
  //
  // A 30 s window holds roughly seven respiratory cycles, and the recovered depth swings
  // wildly across it — measured 105%, 25%, 42%, 16%, 165% on consecutive 5 s steps of the
  // same signal. Harness §5 says the same of the gate: run it on a 300 s record, "not the
  // live 30 s window", because 1/T there is too coarse to separate f1 from the sidebands.
  // The live readout inherits that limit, so it uses the whole buffer and STATES how long
  // that is rather than presenting a swinging number as a reading.
  const buffer = all[ALL_CHANNELS.indexOf('Cz')]!;
  const c = couplingReadout(buffer, stream.truth.chiModDepth, stream.truth.respFreqHz, FS);
  const breaths = stream.segmentSeconds * stream.truth.respFreqHz;
  $('c-inj').textContent = c.injectedDepth.toFixed(4);
  $('c-rec').textContent = Number.isFinite(c.recoveredDepth) ? c.recoveredDepth.toFixed(4) : '—';
  $('c-ret').textContent = Number.isFinite(c.retained) ? `${(100 * c.retained).toFixed(0)}%` : '—';
  $('c-window').textContent =
    `Measured over ${stream.segmentSeconds} s (~${breaths.toFixed(0)} breaths). ` +
    (c.retained > 1.15
      ? 'Above 100% means estimator noise exceeds the injected depth at this record length — ' +
        'the readout is not precise enough to state a loss.'
      : '');

  $('o-broad').textContent = formatExponent(broadbandExponent(pz, FS));
  $('o-narrow').textContent = formatExponent(narrowbandExponent(pz, FS));

  const subset = ['Fz', 'Cz', 'Pz', 'O1'].map((l) =>
    all[ALL_CHANNELS.indexOf(l)]!.subarray(a, b),
  );
  const lz = lempelZiv(subset, Rng.substream(ui.seed, 'lz-ui'), 'lzw');
  $('o-lz').textContent = lz.normalized.toFixed(4);
  $('lz-null').textContent = `Normalized against: ${lz.nullDescription}. Parse: ${lz.parse}.`;

  renderDemo3();
}

function renderDemo3(): void {
  const canvas = $<HTMLCanvasElement>('demo3');
  const dpr = window.devicePixelRatio || 1;
  if (canvas.clientWidth === 0) return;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  const css = (n: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  ctx.fillStyle = css('--paper');
  ctx.fillRect(0, 0, w, h);

  // The graphoelement nearest the playhead, so the demo tracks what is on screen.
  const here = stream.positionS;
  const kc = stream.events
    .filter((e) => e.type === 'kcomplex' || e.type === 'slow_oscillation')
    .sort((p, q) => Math.abs(p.onset - here) - Math.abs(q.onset - here))[0];
  const centre = kc ? kc.onset + kc.duration / 2 : here;
  const spanS = 3;
  const total = stream.channels[0]!.length;
  const a = Math.max(0, Math.min(total - Math.round(spanS * FS), Math.round((centre - spanS / 2) * FS)));
  const b = a + Math.round(spanS * FS);

  const fz = stream.channels[ALL_CHANNELS.indexOf('Fz')]!.slice(a, b);
  const { filtered: filt, invented } = ringingDemo(fz, ui.hpf, ui.ftype, FS);

  const pxPerUv = scalarValue('display_px_per_mm') / ui.sensitivity;
  const mid = h / 2;
  const draw = (data: Float64Array, colour: string, width: number) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let px = 0; px < w; px++) {
      const i = Math.floor((px / w) * data.length);
      const y = mid - data[i]! * pxPerUv;
      if (px === 0) ctx.moveTo(px + 0.5, y);
      else ctx.lineTo(px + 0.5, y);
    }
    ctx.stroke();
  };
  draw(fz, css('--ink-faint'), 1);
  draw(filt, css('--pen-trace'), 1);
  draw(invented, css('--pen-event'), 1.2);

  let ss = 0;
  for (let i = 0; i < invented.length; i++) ss += invented[i]! * invented[i]!;
  const rms = Math.sqrt(ss / invented.length);

  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = css('--ink-faint');
  ctx.fillText('unfiltered', 8, 14);
  ctx.fillStyle = css('--pen-trace');
  ctx.fillText(`high-passed at ${ui.hpf} Hz (${ui.ftype})`, 8, 26);
  ctx.fillStyle = css('--pen-event');
  ctx.fillText(`invented by the filter — ${rms.toFixed(2)} µV RMS`, 8, 38);
}

// -------------------------------------------------------------------- mount

function select(id: string, values: readonly (string | number)[], current: string | number): HTMLSelectElement {
  const el = $<HTMLSelectElement>(id);
  el.innerHTML = '';
  for (const v of values) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = String(v);
    if (String(v) === String(current)) o.selected = true;
    el.appendChild(o);
  }
  return el;
}

function renderInvented(): void {
  const keys = inventedKeys();
  const host = $('invented-list');
  host.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent =
    `${keys.length} registry parameters are not empirically constrained. Listed because a ` +
    `hidden literal would be worse.`;
  host.appendChild(p);
  const box = document.createElement('div');
  box.className = 'invented';
  box.style.maxHeight = '150px';
  box.style.overflowY = 'auto';
  box.style.fontFamily = 'var(--font-mono)';
  box.style.fontSize = 'var(--size-xs)';
  box.textContent = keys.join('  ·  ');
  host.appendChild(box);
}

function restart(): void {
  stream.reset({ seed: ui.seed, state: ui.state });
  // Prime the playhead by one window, so the chart opens full rather than filling in over the
  // first 30 seconds. A paper chart is already written on when you walk up to it.
  stream.advance(ui.windowS);
  filteredKey = '';
  updateObservables();
}

function mount(): void {
  select('state', STATE_IDS, ui.state).addEventListener('change', (e) => {
    ui.state = (e.target as HTMLSelectElement).value as StateId;
    restart();
  });
  for (const opt of Array.from($<HTMLSelectElement>('state').options)) {
    opt.textContent = STATE_LABELS[opt.value as StateId];
  }

  const seedInput = $<HTMLInputElement>('seed');
  seedInput.value = String(ui.seed);
  seedInput.addEventListener('change', () => {
    const v = Number(seedInput.value);
    if (Number.isInteger(v)) {
      ui.seed = v;
      restart();
    }
  });

  select('window', enumValue('display_window_options'), ui.windowS).addEventListener(
    'change',
    (e) => {
      ui.windowS = Number((e.target as HTMLSelectElement).value);
      updateObservables();
    },
  );

  select('sens', enumValue('display_sensitivity_options'), ui.sensitivity).addEventListener(
    'change',
    (e) => {
      ui.sensitivity = Number((e.target as HTMLSelectElement).value);
    },
  );

  select('hpf', enumValue('hpf_options'), ui.hpf).addEventListener('change', (e) => {
    ui.hpf = Number((e.target as HTMLSelectElement).value);
    filteredKey = '';
    updateObservables();
  });

  for (const btn of Array.from($('ftype').querySelectorAll('button'))) {
    btn.addEventListener('click', () => {
      ui.ftype = (btn as HTMLElement).dataset['v'] as FilterType;
      for (const b of Array.from($('ftype').querySelectorAll('button'))) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      filteredKey = '';
      updateObservables();
    });
  }

  const play = $<HTMLButtonElement>('play');
  play.addEventListener('click', () => {
    ui.running = !ui.running;
    play.textContent = ui.running ? 'pause' : 'play';
    play.setAttribute('aria-pressed', String(ui.running));
  });

  const refBtn = $<HTMLButtonElement>('showref');
  refBtn.addEventListener('click', () => {
    ui.showReference = !ui.showReference;
    refBtn.setAttribute('aria-pressed', String(ui.showReference));
    refBtn.textContent = ui.showReference ? 'hide A1/A2' : 'show A1/A2';
  });

  const scrub = $<HTMLInputElement>('scrub');
  scrub.max = String(stream.segmentSeconds);
  scrub.addEventListener('input', () => {
    ui.running = false;
    play.textContent = 'play';
    stream.seekTo(Number(scrub.value));
    updateObservables();
  });

  $('version').textContent = `generator v${GENERATOR_VERSION}`;

  renderInvented();
  stream.advance(ui.windowS);
  updateObservables();
  setInterval(() => {
    updateObservables();
    if (ui.running) scrub.value = String(stream.positionS);
  }, 1000 / ANALYSIS_HZ);
  requestAnimationFrame(loop);
}

mount();
