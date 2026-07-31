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
import { ALL_CHANNELS, REFERENCE_LABELS, weightsFor } from '../core/generators/projection.ts';
import { STATE_IDS, STATE_LABELS, type StateId } from '../core/types/state.ts';
import {
  applyFilterChain,
  ringingDemo,
  type FilterSpec,
  type FilterType,
} from '../core/filters/hpf.ts';
import { drawSpectrum, spectrumLayout, fToUnit, unitToF } from '../render/spectrum.ts';
import { couplingReadout, respiratoryCoupling } from '../analysis/coupling.ts';
import { broadbandExponent, narrowbandExponent } from '../analysis/psd.ts';
import { lempelZiv } from '../analysis/lz.ts';
import { formatExponent } from '../core/types/exponent.ts';
import { Rng } from '../core/rng/xoshiro128pp.ts';
import type { ComposeResult } from '../core/generators/compose.ts';
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
import {
  scalarValue,
  enumValue,
  uiDomain,
  inventedKeys,
  GENERATOR_VERSION,
} from '../core/registry.ts';

const FS = scalarValue('fs');
const ANALYSIS_HZ = scalarValue('analysis_update');

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/**
 * Like `$`, but honest when the element is absent.
 *
 * Four panels -- Demo 1, Demo 3, Observables and Parameters in use -- were taken off the page and
 * their markup kept verbatim in `docs/archived-panels.html`. The code that fills them is left
 * intact rather than deleted, because deleting it would mean rewriting it to bring the panels
 * back. Each of those renderers now begins by asking for its host element through this and
 * returning if it is not there.
 *
 * `$` stays as it is for elements the page cannot work without: a missing #trace or #state is a
 * bug and should throw at the point of use, not be quietly tolerated.
 */
const $opt = (id: string): HTMLElement | null => document.getElementById(id);

const ui = {
  // WAKE, EYES CLOSED is the opening state: it is the one condition this project has a real
  // corpus for, and its alpha is the feature a first-time reader can recognise without being
  // told what to look at. N3 opened here previously and led with the least typical trace.
  state: 'wake_ec' as StateId,
  seed: scalarValue('snr_calibration_seed'),
  // BOTH ENDS ON, BOTH WIDE OPEN. The filter is a SPEC -- two independently switchable ends, an
  // order and a phase mode -- and it opens with both ends enabled at the extremes of
  // `filter_ui_range`, so the panel shows its full travel and the first drag of either handle
  // narrows the passband rather than switching something on. Read from the registry's own UI
  // domain rather than written as numbers, so the handles cannot start outside their range.
  hpEnabled: true,
  hpHz: uiDomain('filter_ui_range').lo,
  lpEnabled: true,
  lpHz: uiDomain('filter_ui_range').hi,
  forder: scalarValue('filter_order'),
  ftype: 'zeroPhase' as FilterType,
  showRaw: false,
  windowS: 15, // @lit-ok initial display window (s); user-selectable from display_window_options
  // Opens at 15 uV/mm rather than the registry's 7. `display_sensitivity` is the value the
  // amplitude claims are stated at and is left alone; this is only where the control starts, and
  // a coarser scale keeps waking alpha and N3 delta on the same screen without clipping.
  sensitivity: 15, // @lit-ok initial display sensitivity (uV/mm); one of display_sensitivity_options
  running: true,
  /** Scalp only, or scalp plus the mastoid references the AASM criterion needs. */
  showReference: false,
  /** Respiration belt and ECG, below the montage behind a firm boundary. */
  showAux: true,
  /** Mains interference. Off by default -- it sits above every band measured here. */
  lineNoise: false,
  // North American mains, not `line_freq`'s first option. The row's own rationale is "regional
  // mains; selected by DEPLOYMENT", so picking one here is the deployment doing its job -- and it
  // is read OUT of the enum rather than written as a literal, so the registry still owns the set
  // of legal values. Both options stay selectable in the UI.
  lineFreqHz: enumValue('line_freq').at(-1) as number,
  reference: 'linked-mastoid' as ReferenceMode,
};

let stream = new SignalStream({
  seed: ui.seed,
  state: ui.state,
  // All three respiratory mechanisms of Build Plan 5.1, kept separate in the API.
  movementArtifact: true,
  amplitudeModulation: true,
  chiModulation: true,
  lineNoise: ui.lineNoise,
  lineFreqHz: ui.lineFreqHz,
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
  /** Referenced but UNFILTERED, when the overlay is on. */
  raw: Float64Array[] | null;
}
let processed: Processed | null = null;
let processedKey = '';
/** Processed segments by (spec, segment index). Holds at most the two the window can span. */
const segCache = new Map<string, Processed>();

/** The filter as the panel currently describes it. */
function currentSpec(): FilterSpec {
  return {
    highpassHz: ui.hpEnabled ? ui.hpHz : null,
    lowpassHz: ui.lpEnabled ? ui.lpHz : null,
    type: ui.ftype,
    order: ui.forder,
  };
}

/**
 * Filter and reference ONE segment. Cached per segment index, because the display now needs the
 * previous segment as well as the current one and filtering is far too expensive per frame.
 *
 * The filter runs on the WHOLE segment, never on the visible window. Filtering a sliding window
 * would put fresh edge transients into the trace on every frame -- the filter's own ringing,
 * moving with the playhead, which is precisely the artefact Demo 3 exists to point at.
 */
function processSegment(seg: ComposeResult, key: string): Processed {
  const hit = segCache.get(key);
  if (hit) return hit;
  const spec = currentSpec();
  const hp = seg.channels.map((c) => applyFilterChain(c, spec, FS));
  const ref = applyReference(hp, ui.reference);
  const rank = effectiveRank(ref.channels);
  const channels = [...ref.channels];
  const labels = [...ref.labels];
  if (ui.showReference) {
    for (const label of REFERENCE_LABELS) {
      const i = ALL_CHANNELS.indexOf(label);
      if (i >= 0) {
        channels.push(hp[i]!);
        labels.push(`${label}*`);
      }
    }
  }
  const rawRef = ui.showRaw ? applyReference([...seg.channels], ui.reference) : null;
  const out: Processed = { channels, labels, rank, raw: rawRef?.channels ?? null };
  segCache.set(key, out);
  // Two segments are all the display can show at once; anything older is dead weight.
  while (segCache.size > 2) segCache.delete(segCache.keys().next().value as string);
  return out;
}

/** Settings that change the processed signal. Part of every segment cache key. */
function specKey(): string {
  return (
    `${ui.hpEnabled}|${ui.hpHz}|${ui.lpEnabled}|${ui.lpHz}|${ui.forder}|${ui.ftype}|` +
    `${ui.reference}|${ui.showReference}|${ui.showRaw}`
  );
}

function ensureProcessed(): Processed {
  const key =
    `${ui.hpEnabled}|${ui.hpHz}|${ui.lpEnabled}|${ui.lpHz}|${ui.forder}|${ui.ftype}|` +
    `${ui.reference}|${ui.showReference}|${stream.elapsedS - stream.positionS}`;
  if (key !== processedKey || processed === null) {
    const spec = currentSpec();
    const hp = stream.channels.map((c) => applyFilterChain(c, spec, FS));
    const ref = applyReference(hp, ui.reference);

    // THE RANK IS COMPUTED ON THE SCALP SET ONLY, before the mastoids are appended for display.
    // A1/A2 are shown raw, so counting them would change the reported dimensionality of the
    // montage just because a display toggle was pressed.
    const rank = effectiveRank(ref.channels);

    const channels = [...ref.channels];
    const labels = [...ref.labels];
    if (ui.showReference) {
      // Appended AS GENERATED, not referenced. A mastoid referenced to itself is zero, and to
      // the other mastoid is the difference of the two -- neither is the trace a reader wants
      // when they ask to see what the reference is doing. `referencing.ts` says the same thing
      // where it drops them from its output.
      for (const label of REFERENCE_LABELS) {
        const i = ALL_CHANNELS.indexOf(label);
        if (i >= 0) {
          channels.push(hp[i]!);
          labels.push(`${label}*`);
        }
      }
    }

    // The RAW view, referenced the same way but unfiltered, for the overlay. Computed here so
    // it shares the cache: recomputing it per frame would double the reference cost.
    const rawRef = ui.showRaw ? applyReference([...stream.channels], ui.reference) : null;

    processed = { channels, labels, rank, raw: rawRef?.channels ?? null };
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

/**
 * The visible window, spliced across a segment join and left-padded with silence at the start.
 *
 * TWO DEFECTS CAME FROM CLAMPING THE WINDOW START AT ZERO INSTEAD, and they were the same defect.
 * At a segment roll `positionS` wraps to ~0, so `max(0, tEnd - windowS)` pinned the window's left
 * edge for a full `windowS` afterwards and the trace stood still -- "the scroll stops after about
 * 90 s", which is `display_buffer_s` exactly. At startup the same clamp made the window open
 * already full of signal instead of filling in.
 *
 * Here the window is always [tEnd - windowS, tEnd] in stream time. Samples earlier than the
 * stream's start are left as NaN, which `trace.ts` skips, so the pen genuinely draws onto blank
 * paper for the first `windowS` seconds and never again.
 */
function windowed(
  cur: readonly Float64Array[],
  prv: readonly Float64Array[] | null,
  tEndS: number,
  segS: number,
): Float64Array[] {
  const n = Math.round(ui.windowS * FS);
  const endIdx = Math.round(tEndS * FS);
  const segN = Math.round(segS * FS);
  return cur.map((c, ch) => {
    const out = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const idx = endIdx - n + i;
      if (idx >= 0) out[i] = c[idx] ?? NaN;
      else if (prv) out[i] = prv[ch]?.[segN + idx] ?? NaN;
    }
    return out;
  });
}

function drawFrame(): void {
  const p = ensureProcessed();
  const spec = specKey();
  const prevSeg = stream.previous;
  const prevProc = prevSeg ? processSegment(prevSeg, `${spec}|${stream.segmentIndex - 1}`) : null;

  const tEnd = stream.positionS;
  /** Window start in the CURRENT segment's time base. Negative means it reaches into `prev`. */
  const winStart = tEnd - ui.windowS;
  const data = windowed(p.channels, prevProc?.channels ?? null, tEnd, stream.segmentSeconds);
  const labels = p.labels;

  // The playhead sits at the RIGHT edge, as on a paper chart: new signal arrives at the pen and
  // older signal scrolls left out of view. The window array IS the window, so its own start is
  // the offset the renderer draws from.
  const tStart = 0;

  drawTrace($<HTMLCanvasElement>('trace'), {
    channels: data,
    labels,
    fs: FS,
    sensitivityUvPerMm: ui.sensitivity,
    pxPerMm: scalarValue('display_px_per_mm'),
    // EVERY LANE AND EVERY EVENT MOVES INTO WINDOW TIME, not just the montage. The window now
    // spans a segment join, so anything still expressed in segment time would sit at the wrong
    // place on the screen -- an event band a whole segment adrift from the wave it marks.
    events: [
      ...(prevSeg?.events ?? []).map((e) => ({ ...e, onset: e.onset - stream.segmentSeconds })),
      ...stream.events,
    ]
      .map((e) => ({ onset: e.onset - winStart, duration: e.duration, type: e.type }))
      .filter((e) => e.onset + e.duration > 0 && e.onset < ui.windowS),
    raw: p.raw ? windowed(p.raw, prevProc?.raw ?? null, tEnd, stream.segmentSeconds) : [],
    aux: ui.showAux
      ? [
          {
            label: 'Resp',
            data: windowed([stream.respirationBelt],
              prevSeg ? [prevSeg.respirationBelt] : null, tEnd, stream.segmentSeconds)[0]!,
            unit: 'a.u.',
          },
          {
            label: 'ECG',
            data: windowed([stream.ecg], prevSeg ? [prevSeg.ecg] : null, tEnd,
              stream.segmentSeconds)[0]!,
            unit: 'µV',
          },
        ]
      : [],
    windowS: ui.windowS,
    tOffsetS: tStart,
  });

  $('clock').textContent =
    `t = ${stream.elapsedS.toFixed(1)} s   ·   ${ui.windowS} s window   ·   ` +
    `${ui.sensitivity} µV/mm   ·   ${labels.length} ch`;
}

/**
 * Exposed so a non-compositing environment can step the display deterministically.
 *
 * `window` reports what `windowed()` produced for the current playhead WITHOUT needing the canvas
 * to paint, which is the only way to check the display in a headless or hidden tab -- there,
 * requestAnimationFrame never runs, the canvas is never sized, and every pixel assertion is
 * vacuous. It reports the leading blank because that is the whole contract of the fix: blank for
 * the first window and never again, including across a segment join.
 */
(globalThis as Record<string, unknown>)['__eegsim'] = {
  step: (dt: number) => {
    stream.advance(dt);
    updateObservables();
  },
  position: () => stream.positionS,
  elapsed: () => stream.elapsedS,
  window: () => {
    const p = ensureProcessed();
    const prevSeg = stream.previous;
    const prevProc = prevSeg
      ? processSegment(prevSeg, `${specKey()}|${stream.segmentIndex - 1}`)
      : null;
    const w = windowed(
      p.channels, prevProc?.channels ?? null, stream.positionS, stream.segmentSeconds,
    )[0]!;
    let lead = 0;
    while (lead < w.length && !Number.isFinite(w[lead]!)) lead++;
    let gaps = 0;
    for (let i = lead; i < w.length; i++) if (!Number.isFinite(w[i]!)) gaps++;
    return { samples: w.length, leadingBlank: lead, blankAfterSignal: gaps };
  },
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
  // Panel archived out of index.html; see $opt. Restoring the markup re-enables this with no
  // other change.
  if (!$opt('c-chi')) return;
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
  // The injected value is folded into the "of injected" percentage rather than given its own
  // row: it is a constant the reader cannot change, so as a row it was one more number to
  // ignore. The percentage is the part that moves.
  $('c-rec').textContent = `${recovered.toFixed(2)} µV`;
  $('c-ret').textContent =
    injected > 0 ? `${((100 * recovered) / injected).toFixed(0)}% of ${injected.toFixed(1)} µV` : '—';

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
  drawSpectrumPanel();
  $('ref-note').textContent = REFERENCE_NOTE[ui.reference];

  renderDemo3();
}

/**
 * What Demo 3 should show in each state, and where a state has nothing to show.
 *
 * The ringing demonstration needs a sharp transient: the filter's invented energy is largest
 * where the signal changes fastest. Every state has a different largest transient, and wake_eo
 * has none worth the name -- beta on an aperiodic background is not a graphoelement, and
 * pretending otherwise was the bug.
 */
const DEMO3_FEATURE: Record<StateId, { types: string[]; label: string } | null> = {
  wake_eo: null,
  wake_ec: null,
  n1: null,
  n2: { types: ['kcomplex'], label: 'K-complex' },
  n3: { types: ['slow_oscillation'], label: 'slow oscillation' },
  rem: null,
};

function renderDemo3(): void {
  // Panel archived out of index.html; see $opt. Restoring the markup re-enables this with no
  // other change.
  if (!$opt('demo3')) return;
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

  // THE FEATURE THIS STATE ACTUALLY HAS, not a K-complex regardless.
  //
  // The demo used to hunt for a K-complex or slow oscillation in every state and silently fall
  // back to the playhead when there was none -- so in wake and REM it showed an unlabelled
  // stretch of background and called it a K-complex demonstration. Each state has its own
  // largest transient, and where a state has no graphoelement at all the honest thing is to say
  // so rather than to dress up background.
  const here = stream.positionS;
  const wanted = DEMO3_FEATURE[ui.state];
  const pick = wanted
    ? stream.events
        .filter((e) => wanted.types.includes(e.type))
        .sort((p, q) => Math.abs(p.onset - here) - Math.abs(q.onset - here))[0]
    : undefined;
  const centre = pick ? pick.onset + pick.duration / 2 : here;
  const spanS = 3; // @lit-ok Demo 3 display span (s)
  const total = stream.channels[0]!.length;
  const a = Math.max(0, Math.min(total - Math.round(spanS * FS), Math.round((centre - spanS / 2) * FS)));
  const b = a + Math.round(spanS * FS);

  const fz = stream.channels[ALL_CHANNELS.indexOf('Fz')]!.slice(a, b);
  const { filtered: filt, invented } = ringingDemo(fz, ui.hpEnabled ? ui.hpHz : 0, ui.ftype, FS);

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
  ctx.fillText(`high-passed at ${ui.hpEnabled ? ui.hpHz : 0} Hz (${ui.ftype})`, 8, 26); // @lit-ok Demo 3 canvas label coordinates (px)
  ctx.fillStyle = css('--pen-event');
  ctx.fillText(`invented by the filter — ${rms.toFixed(2)} µV RMS`, 8, 38); // @lit-ok Demo 3 canvas label coordinates (px)

  const note = $('demo3-note');
  if (!wanted) {
    note.textContent =
      `${STATE_LABELS[ui.state]} generates no graphoelement, so there is no sharp transient ` +
      `for the filter to ring on. The trace below is background; the ringing demonstration ` +
      `needs N2 (K-complex) or N3 (slow oscillation).`;
  } else if (!pick) {
    note.textContent =
      `Waiting for a ${wanted.label} to appear in the buffer — they are Poisson-scheduled, ` +
      `not periodic.`;
  } else {
    note.textContent =
      `Centred on a ${wanted.label} at t = ${pick.onset.toFixed(1)} s. ` +
      `${rms.toFixed(2)} µV RMS of the red trace is energy the filter created, not signal.`;
  }
}


// ------------------------------------------------------------- filter panel

const FILT_RANGE = uiDomain('filter_ui_range');
/** Slider positions are integers; the mapping to frequency is logarithmic. */
const SLIDER_MAX = 1000; // @lit-ok slider resolution in steps, a UI control granularity

function sliderToHz(v: number): number {
  return unitToF(v / SLIDER_MAX, FILT_RANGE.lo, FILT_RANGE.hi);
}
function hzToSlider(f: number): number {
  return Math.round(fToUnit(f, FILT_RANGE.lo, FILT_RANGE.hi) * SLIDER_MAX);
}
function fmtHz(f: number): string {
  return `${f < 1 ? f.toFixed(2) : f.toFixed(f < 10 ? 1 : 0)} Hz`; // @lit-ok display precision thresholds
}

function refreshFilterUi(): void {
  $('hp-val').textContent = ui.hpEnabled ? fmtHz(ui.hpHz) : 'off';
  $('lp-val').textContent = ui.lpEnabled ? fmtHz(ui.lpHz) : 'off';
  $<HTMLInputElement>('hp-slider').disabled = !ui.hpEnabled;
  $<HTMLInputElement>('lp-slider').disabled = !ui.lpEnabled;
  processedKey = '';
  drawSpectrumPanel();
  updateObservables();
}

function drawSpectrumPanel(): void {
  const p = ensureProcessed();
  // The spectrum is drawn on the UNFILTERED referenced channel and filters it itself, so the
  // raw curve is genuinely raw. Drawing it on `p.channels` would show a filtered signal being
  // filtered again, and the "raw" curve would already have the stopband in it.
  const rawRef = p.raw ? p.raw[p.labels.indexOf('Pz')] : null;
  const src = rawRef ?? chan(p, 'Pz');
  drawSpectrum($<HTMLCanvasElement>('spectrum'), {
    raw: src,
    fs: FS,
    spec: currentSpec(),
    fMin: FILT_RANGE.lo,
    fMax: Math.min(FILT_RANGE.hi, FS / 2),
    showFiltered: ui.hpEnabled || ui.lpEnabled,
  });
}

function mountFilterPanel(): void {
  const hpOn = $<HTMLInputElement>('hp-on');
  const lpOn = $<HTMLInputElement>('lp-on');
  const hpS = $<HTMLInputElement>('hp-slider');
  const lpS = $<HTMLInputElement>('lp-slider');

  hpS.max = String(SLIDER_MAX);
  lpS.max = String(SLIDER_MAX);
  hpS.value = String(hzToSlider(ui.hpHz));
  lpS.value = String(hzToSlider(ui.lpHz));
  hpOn.checked = ui.hpEnabled;
  lpOn.checked = ui.lpEnabled;

  hpOn.addEventListener('change', () => {
    ui.hpEnabled = hpOn.checked;
    refreshFilterUi();
  });
  lpOn.addEventListener('change', () => {
    ui.lpEnabled = lpOn.checked;
    refreshFilterUi();
  });
  hpS.addEventListener('input', () => {
    // THE ENDS MAY NOT CROSS. A high-pass above the low-pass is an empty passband, and the
    // display would go silently flat rather than obviously wrong.
    ui.hpHz = Math.min(sliderToHz(Number(hpS.value)), ui.lpHz * 0.9); // @lit-ok minimum passband ratio, keeping the two ends from crossing
    hpS.value = String(hzToSlider(ui.hpHz));
    refreshFilterUi();
  });
  lpS.addEventListener('input', () => {
    ui.lpHz = Math.max(sliderToHz(Number(lpS.value)), ui.hpHz / 0.9); // @lit-ok as above
    lpS.value = String(hzToSlider(ui.lpHz));
    refreshFilterUi();
  });

  select('forder', enumValue('filter_order_options'), ui.forder).addEventListener('change', (e) => {
    ui.forder = Number((e.target as HTMLSelectElement).value);
    refreshFilterUi();
  });

  const rawBtn = $<HTMLButtonElement>('showraw');
  rawBtn.addEventListener('click', () => {
    ui.showRaw = !ui.showRaw;
    rawBtn.setAttribute('aria-pressed', String(ui.showRaw));
    rawBtn.textContent = ui.showRaw ? 'hide raw overlay' : 'overlay raw on trace';
    refreshFilterUi();
  });

  // Dragging the handles ON the spectrum, which is the control the panel is really about: the
  // sliders below are the same state, kept in sync, for keyboard and for readers who want a
  // number rather than a gesture.
  const canvas = $<HTMLCanvasElement>('spectrum');
  let dragging: 'hp' | 'lp' | null = null;

  const nearest = (x: number): 'hp' | 'lp' | null => {
    const { left, right } = spectrumLayout(canvas);
    const u = (x - left) / (right - left);
    const f = unitToF(u, FILT_RANGE.lo, Math.min(FILT_RANGE.hi, FS / 2));
    const dHp = ui.hpEnabled ? Math.abs(Math.log10(f) - Math.log10(ui.hpHz)) : Infinity;
    const dLp = ui.lpEnabled ? Math.abs(Math.log10(f) - Math.log10(ui.lpHz)) : Infinity;
    if (!Number.isFinite(Math.min(dHp, dLp))) return null;
    return dHp <= dLp ? 'hp' : 'lp';
  };

  const setFrom = (x: number): void => {
    const { left, right } = spectrumLayout(canvas);
    const f = unitToF((x - left) / (right - left), FILT_RANGE.lo, Math.min(FILT_RANGE.hi, FS / 2));
    if (dragging === 'hp') {
      ui.hpHz = Math.min(Math.max(f, FILT_RANGE.lo), ui.lpHz * 0.9); // @lit-ok as above
      hpS.value = String(hzToSlider(ui.hpHz));
    } else if (dragging === 'lp') {
      ui.lpHz = Math.max(Math.min(f, Math.min(FILT_RANGE.hi, FS / 2)), ui.hpHz / 0.9); // @lit-ok as above
      lpS.value = String(hzToSlider(ui.lpHz));
    }
    refreshFilterUi();
  };

  canvas.addEventListener('pointerdown', (e) => {
    dragging = nearest(e.offsetX);
    if (dragging) {
      canvas.setPointerCapture(e.pointerId);
      setFrom(e.offsetX);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) setFrom(e.offsetX);
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = null;
    canvas.releasePointerCapture(e.pointerId);
  });

  refreshFilterUi();
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
  // Panel archived out of index.html; see $opt. Restoring the markup re-enables this with no
  // other change.
  if (!$opt('invented-list')) return;
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
  stream.reset({
    seed: ui.seed, state: ui.state,
    lineNoise: ui.lineNoise, lineFreqHz: ui.lineFreqHz,
  });
  // THE PLAYHEAD IS NO LONGER PRIMED. It used to be advanced by one window so the chart opened
  // already full -- "a paper chart is already written on when you walk up to it". Reversed on
  // request: the pen now starts at the left of blank paper and the trace fills in as it is
  // generated, which is what a recording actually looks like starting up.
  processedKey = '';
  segCache.clear();
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

  // A NEW SEED IS A NEW SUBJECT, not a new setting, which is why it gets its own button rather
  // than being a spinner on the number. Every parameter is unchanged; only the draws differ.
  // The value stays visible and typeable so a seed can be written down and returned to --
  // determinism is only useful if the reader can act on it (G2).
  // RESET, NOT RELOAD. Same seed, same state, same controls -- back to t = 0 with the paper
  // blank again. It exists because the stream is deterministic: rewinding to the start of a known
  // seed and watching the same signal a second time is a thing a reader will want, and reloading
  // the page would also throw away the montage, filter and sensitivity they had set up.
  $<HTMLButtonElement>('reset').addEventListener('click', () => {
    restart();
  });

  $<HTMLButtonElement>('newseed').addEventListener('click', () => {
    ui.seed = Math.floor(Math.random() * 2_000_000_000); // @lit-ok seed range, an arbitrary large integer
    seedInput.value = String(ui.seed);
    restart();
  });

  const auxBtn = $<HTMLButtonElement>('showaux');
  auxBtn.addEventListener('click', () => {
    ui.showAux = !ui.showAux;
    auxBtn.setAttribute('aria-pressed', String(ui.showAux));
    auxBtn.textContent = ui.showAux ? 'hide resp/ECG' : 'show resp/ECG';
  });

  const lineBtn = $<HTMLButtonElement>('linenoise');
  const setLineLabel = () => {
    lineBtn.setAttribute('aria-pressed', String(ui.lineNoise));
    lineBtn.textContent = ui.lineNoise ? `${ui.lineFreqHz} Hz mains on` : 'mains off';
  };
  setLineLabel();
  lineBtn.addEventListener('click', () => {
    ui.lineNoise = !ui.lineNoise;
    setLineLabel();
    restart();
  });

  select('linefreq', enumValue('line_freq'), ui.lineFreqHz).addEventListener('change', (e) => {
    ui.lineFreqHz = Number((e.target as HTMLSelectElement).value);
    setLineLabel();
    if (ui.lineNoise) restart();
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

  mountFilterPanel();

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
  // NOT PRIMED. mount() advanced the playhead by one window here as well as in restart(), so
  // removing it from restart() alone left the page still opening on a full chart. The trace now
  // starts at t = 0 on blank paper in both paths.
  updateObservables();
  setInterval(() => {
    updateObservables();
    if (ui.running) scrub.value = String(stream.positionS);
  }, 1000 / ANALYSIS_HZ); // @lit-ok milliseconds per second
  requestAnimationFrame(loop);
}

mount();
