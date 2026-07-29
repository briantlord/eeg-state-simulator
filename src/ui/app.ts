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
import { ALL_CHANNELS, weightsFor } from '../core/generators/projection.ts';
import { STATE_IDS, STATE_LABELS, type StateId } from '../core/types/state.ts';
import { applyHighpass, ringingDemo, type FilterType } from '../core/filters/hpf.ts';
import { couplingReadout, respiratoryCoupling } from '../analysis/coupling.ts';
import { broadbandExponent, narrowbandExponent } from '../analysis/psd.ts';
import { lempelZiv } from '../analysis/lz.ts';
import { formatExponent } from '../core/types/exponent.ts';
import { Rng } from '../core/rng/xoshiro128pp.ts';
import { drawTrace } from '../render/trace.ts';
import { SignalStream } from './stream.ts';
import {
  applyReference,
  effectiveRank,
  referencedGain,
  REFERENCE_LABEL,
  REFERENCE_NOTE,
  type ReferenceMode,
} from '../analysis/referencing.ts';
import { scalarValue, enumValue, inventedKeys, GENERATOR_VERSION } from '../core/registry.ts';

const FS = scalarValue('fs');
const ANALYSIS_HZ = scalarValue('analysis_update');

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ui = {
  state: 'n3' as StateId,
  seed: scalarValue('snr_calibration_seed'),
  hpf: enumValue('hpf_options')[0] as number,
  ftype: 'zeroPhase' as FilterType,
  windowS: 30, // @lit-ok initial display window (s); user-selectable, 30 s = the AASM scoring epoch
  sensitivity: scalarValue('display_sensitivity'),
  running: true,
  /** Scalp only, or scalp plus the mastoid references the AASM criterion needs. */
  showReference: false,
  reference: 'linked-mastoid' as ReferenceMode,
};

let stream = new SignalStream({
  seed: ui.seed,
  state: ui.state,
  // All three respiratory mechanisms of Build Plan 5.1, kept separate in the API.
  movementArtifact: true,
  amplitudeModulation: true,
  chiModulation: true,
});

/**
 * The processed view of the current segment: high-pass, then reference.
 *
 * IN THAT ORDER, because that is the order a real pipeline applies them, and the order
 * matters — referencing mixes channels, so filtering afterwards would filter the mixture.
 * Cached, so moving the playhead does not redo it every frame.
 */
interface Processed {
  channels: Float64Array[];
  labels: string[];
  rank: number;
}
let processed: Processed | null = null;
let processedKey = '';

function ensureProcessed(): Processed {
  const key = `${ui.hpf}|${ui.ftype}|${ui.reference}|${stream.elapsedS - stream.positionS}`;
  if (key !== processedKey || processed === null) {
    const hp = stream.channels.map((c) => applyHighpass(c, ui.hpf, ui.ftype, FS));
    const ref = applyReference(hp, ui.reference);
    processed = {
      channels: ref.channels,
      labels: ref.labels,
      rank: effectiveRank(ref.channels),
    };
    processedKey = key;
  }
  return processed;
}

/** Look up a scalp channel in the referenced set. */
function chan(p: Processed, label: string): Float64Array {
  const i = p.labels.indexOf(label);
  return p.channels[i >= 0 ? i : 0]!;
}

// --------------------------------------------------------------------- trace

function drawFrame(): void {
  const p = ensureProcessed();
  const data = p.channels;
  const labels = p.labels;

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
  const dt = Math.min(0.25, (now - last) / 1000); // @lit-ok frame dt clamp (0.25 s) and milliseconds per second
  last = now;
  if (ui.running) stream.advance(dt);
  drawFrame();
  requestAnimationFrame(loop);
}

// -------------------------------------------------------------- observables

function updateObservables(): void {
  const p = ensureProcessed();
  // Analyse the window on screen, not the whole buffer: the readout should describe what the
  // reader is looking at.
  const tEnd = stream.positionS;
  const tStart = Math.max(0, tEnd - ui.windowS);
  const a = Math.round(tStart * FS);
  const b = Math.round(tEnd * FS);
  if (b - a < FS * 2) return;

  const pz = chan(p, 'Pz').subarray(a, b);

  // COUPLING IS MEASURED OVER THE WHOLE BUFFER, NOT THE VISIBLE WINDOW.
  //
  // A 30 s window holds roughly seven respiratory cycles, and the recovered depth swings
  // wildly across it — measured 105%, 25%, 42%, 16%, 165% on consecutive 5 s steps of the
  // same signal. Harness §5 says the same of the gate: run it on a 300 s record, "not the
  // live 30 s window", because 1/T there is too coarse to separate f1 from the sidebands.
  // The live readout inherits that limit, so it uses the whole buffer and STATES how long
  // that is rather than presenting a swinging number as a reading.
  const buffer = chan(p, 'Fz');
  const breaths = stream.segmentSeconds * stream.truth.respFreqHz;

  // DEMO 1 REPORTS DIRECT respiration-EEG coupling in µV — the component locked to
  // respiratory phase. That is the quantity a clinical high-pass annihilates, because it sits
  // AT the respiratory rate. Envelope and exponent modulations are retained at ~100% across
  // the entire cutoff range and would show nothing; see the note in coupling.ts.
  // Ground truth AT THE ELECTRODE, not at the source: the injected amplitude times the gain
  // of projection-then-reference. Otherwise geometry reads as filter loss (see
  // `referencedGain`).
  const gain = referencedGain(weightsFor('resp_artifact'), ui.reference, 'Fz');
  const injected = stream.truth.respArtifactAmpUv * Math.abs(gain);
  const recovered = respiratoryCoupling(buffer, stream.respirationPhase);
  $('c-inj').textContent = `${injected.toFixed(1)} µV`;
  $('c-rec').textContent = `${recovered.toFixed(2)} µV`;
  $('c-ret').textContent = injected > 0 ? `${((100 * recovered) / injected).toFixed(0)}%` : '—';

  // THE NOISE FLOOR, measured rather than asserted. `respiratoryCoupling` is a projection onto
  // one phase, so it returns something positive from any signal — chance alignment over a
  // finite buffer is not zero, which is why retained reads slightly over 100% and, under the
  // Laplacian where the injected amplitude is small, well over.
  //
  // The null is an OFF-RESONANCE probe: the same estimator against a phase ramp at 1.7x the
  // respiratory rate, where nothing was injected. NOT a circular rotation of the real phase,
  // which was the first thing tried and is wrong here — respiration is near-periodic, so a
  // rotation by half a cycle anti-aligns, and this estimator takes a magnitude, so an
  // anti-aligned surrogate returns the SIGNAL back rather than a null.
  const nullPhase = new Float64Array(buffer.length);
  const wNull = (2 * Math.PI * 1.7 * stream.truth.respFreqHz) / FS; // @lit-ok off-resonance factor for the noise-floor probe; any value clearly off the respiratory rate serves (see coupling.ts, test/coupling.test.ts)
  for (let i = 0; i < nullPhase.length; i++) nullPhase[i] = i * wNull;
  $('c-floor').textContent = `${respiratoryCoupling(buffer, nullPhase).toFixed(2)} µV`;

  // The mechanism the filter does NOT remove, beside it, so the contrast is the lesson
  // rather than a footnote.
  //
  // LABELLED (c), NOT "chi modulation", and the distinction cost a gate to find. Mechanism (c)
  // has two halves and this reads chi-hat at the respiratory rate, where both can appear.
  //
  // The exposure is much smaller than it was. Under the two-band ratio, whose low band was
  // 2-8 Hz, (c)'s AMPLITUDE half (0.5-4 Hz) leaked in at 3.3x the floor and dominated the row.
  // chi-hat is now a least-squares slope over chi_est_band (2-40 Hz), where a change confined to
  // the band's low edge has little leverage: measured leakage 0.033 against a detection floor of
  // 0.048 (Finding 16). The reading also changed UNITS -- true chi rather than the old proxy's
  // 0.76-per-chi -- so it is now comparable to the registry depth, which it never was.
  //
  // Still a control rather than a measurement: the shipped depth sits ~3x above the floor, so
  // calling this the exponent modulation would claim more than the generator supports.
  const c = couplingReadout(buffer, stream.truth.chiModDepth, stream.truth.respFreqHz, FS);
  $('c-chi').textContent = Number.isFinite(c.recoveredDepth) ? c.recoveredDepth.toFixed(3) : '—'; // @lit-ok display precision (3 decimals)
  $('c-window').textContent =
    `Measured over ${stream.segmentSeconds} s (~${breaths.toFixed(0)} breaths).`;

  $('o-broad').textContent = formatExponent(broadbandExponent(pz, FS));
  $('o-narrow').textContent = formatExponent(narrowbandExponent(pz, FS));

  const subset = ['Fz', 'Cz', 'Pz', 'O1'].map((l) => chan(p, l).subarray(a, b));
  const lz = lempelZiv(subset, Rng.substream(ui.seed, 'lz-ui'), 'lzw');
  $('o-lz').textContent = lz.normalized.toFixed(4); // @lit-ok display precision (4 decimals)
  $('lz-null').textContent = `Normalized against: ${lz.nullDescription}. Parse: ${lz.parse}.`;

  // Effective dimensionality, and the reference that produced it. Referencing is a rank
  // operation, so the two belong on screen together.
  $('o-rank').textContent = p.rank.toFixed(2);
  $('ref-note').textContent = REFERENCE_NOTE[ui.reference];

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
  const spanS = 3; // @lit-ok Demo 3 display span (s)
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
  draw(invented, css('--pen-event'), 1.2); // @lit-ok Demo 3 canvas line width (px)

  let ss = 0;
  for (let i = 0; i < invented.length; i++) ss += invented[i]! * invented[i]!;
  const rms = Math.sqrt(ss / invented.length);

  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = css('--ink-faint');
  ctx.fillText('unfiltered', 8, 14); // @lit-ok Demo 3 canvas label coordinates (px)
  ctx.fillStyle = css('--pen-trace');
  ctx.fillText(`high-passed at ${ui.hpf} Hz (${ui.ftype})`, 8, 26); // @lit-ok Demo 3 canvas label coordinates (px)
  ctx.fillStyle = css('--pen-event');
  ctx.fillText(`invented by the filter — ${rms.toFixed(2)} µV RMS`, 8, 38); // @lit-ok Demo 3 canvas label coordinates (px)
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
  processedKey = '';
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

  const refSel = select(
    'reference',
    ['as-generated', 'linked-mastoid', 'contralateral', 'average', 'laplacian'],
    ui.reference,
  );
  for (const opt of Array.from(refSel.options)) {
    opt.textContent = REFERENCE_LABEL[opt.value as ReferenceMode];
  }
  refSel.addEventListener('change', (e) => {
    ui.reference = (e.target as HTMLSelectElement).value as ReferenceMode;
    processedKey = '';
    updateObservables();
  });

  select('hpf', enumValue('hpf_options'), ui.hpf).addEventListener('change', (e) => {
    ui.hpf = Number((e.target as HTMLSelectElement).value);
    processedKey = '';
    updateObservables();
  });

  for (const btn of Array.from($('ftype').querySelectorAll('button'))) {
    btn.addEventListener('click', () => {
      ui.ftype = (btn as HTMLElement).dataset['v'] as FilterType;
      for (const b of Array.from($('ftype').querySelectorAll('button'))) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      processedKey = '';
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
  }, 1000 / ANALYSIS_HZ); // @lit-ok milliseconds per second
  requestAnimationFrame(loop);
}

mount();
