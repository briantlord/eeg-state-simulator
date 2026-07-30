/**
 * The high-pass filter under test (Build Plan §5.4) — the signature feature.
 *
 * "STANDARD EEG PRACTICE HIGH-PASSES AT 0.5–1 Hz, DIRECTLY ON TOP OF THE RESPIRATORY RATE. A
 * simulator with injected, known coupling and a user-adjustable filter demonstrates that loss
 * with ground truth, which no real dataset can — with real data you never knew the pre-filter
 * coupling."
 *
 * Two filter types, because the difference between them is half the demonstration:
 *
 *   `zeroPhase` — forward then backward. No phase distortion, at the cost of being
 *                 non-causal, i.e. unusable on a live recording.
 *   `causal`    — forward only. What a real acquisition system does, and what distorts phase
 *                 near the cutoff. Demo 2 is precisely that: "causal IIR distorts phase near
 *                 cutoff; coupling estimates corrupt even where amplitude survives."
 *
 * The honest lesson this is built to carry: high-pass filtering trades a KNOWN ARTIFACT for a
 * KNOWN DISTORTION. Not that filtering is a mistake.
 */
import { applyBiquad, butterworthQs, highpass, lowpass, type Biquad } from '../dsp/biquad.ts';
import { scalarValue } from '../registry.ts';

export type FilterType = 'zeroPhase' | 'causal';

export function highpassSections(cutoffHz: number, fs: number, order = 4): Biquad[] { // @lit-ok default Butterworth order; callers pass the cutoff from the registry
  return butterworthQs(order).map((q) => highpass(cutoffHz, fs, q));
}

/** Apply a high-pass, returning a new array. */
export function applyHighpass(
  x: Float64Array,
  cutoffHz: number,
  type: FilterType,
  fs = scalarValue('fs'),
): Float64Array {
  const y = Float64Array.from(x);
  const sections = highpassSections(cutoffHz, fs, scalarValue('filter_order'));
  for (const s of sections) applyBiquad(y, s);
  if (type === 'zeroPhase') {
    y.reverse();
    for (const s of sections) applyBiquad(y, s);
    y.reverse();
  }
  return y;
}

/**
 * Ringing on an isolated graphoelement — Demo 3.
 *
 * "Apply a 1 Hz high-pass to an isolated K-complex and watch spurious oscillatory ringing
 * appear, AT FREQUENCIES RESEMBLING A SPINDLE. Most visceral of the three because it is
 * visible in the trace, and with ground truth you can label which deflections the filter
 * invented."
 *
 * Returns the filtered trace alongside the original so the caller can draw both and mark the
 * difference — the invented deflections are exactly what the filter added, and nothing else
 * in this project can point at them with certainty.
 */
export function ringingDemo(
  x: Float64Array,
  cutoffHz: number,
  type: FilterType,
  fs = scalarValue('fs'),
): { original: Float64Array; filtered: Float64Array; invented: Float64Array } {
  const filtered = applyHighpass(x, cutoffHz, type, fs);
  const invented = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) invented[i] = filtered[i]! - x[i]!;
  return { original: x, filtered, invented };
}

// ---------------------------------------------------------------- filter chain

/**
 * A complete acquisition filter: an optional high-pass, an optional low-pass, an order and a
 * phase mode.
 *
 * SEPARATE NULLABLE CUTOFFS rather than a single band, because "no high-pass" and "high-pass at
 * DC" are different things a reader should be able to tell apart, and because the demonstration
 * is about what each END does. A band would force both on together and hide which one caused
 * what.
 */
export interface FilterSpec {
  /** High-pass cutoff in Hz, or null for none. */
  readonly highpassHz: number | null;
  /** Low-pass cutoff in Hz, or null for none. */
  readonly lowpassHz: number | null;
  readonly type: FilterType;
  /** Butterworth order. Steeper rolls off faster AND rings longer — that is the trade. */
  readonly order: number;
}

/** Sections for a spec, in application order. Empty when both ends are off. */
export function chainSections(spec: FilterSpec, fs: number): Biquad[] {
  const out: Biquad[] = [];
  const nyquist = fs / 2;
  if (spec.highpassHz !== null && spec.highpassHz > 0) {
    for (const q of butterworthQs(spec.order)) out.push(highpass(spec.highpassHz, fs, q));
  }
  if (spec.lowpassHz !== null && spec.lowpassHz < nyquist) {
    for (const q of butterworthQs(spec.order)) out.push(lowpass(spec.lowpassHz, fs, q));
  }
  return out;
}

/**
 * Apply a filter chain, returning a new array. A spec with both ends off returns a copy.
 *
 * Zero-phase runs the cascade forwards then backwards, which SQUARES the magnitude response —
 * so a zero-phase filter of order N has the stopband of order 2N while having no phase
 * distortion at all. That is the trade the panel exists to show, and it is why the two modes
 * cannot be compared by cutoff alone.
 */
export function applyFilterChain(
  x: Float64Array,
  spec: FilterSpec,
  fs = scalarValue('fs'),
): Float64Array {
  const y = Float64Array.from(x);
  const sections = chainSections(spec, fs);
  if (sections.length === 0) return y;
  for (const s of sections) applyBiquad(y, s);
  if (spec.type === 'zeroPhase') {
    y.reverse();
    for (const s of sections) applyBiquad(y, s);
    y.reverse();
  }
  return y;
}

/**
 * Magnitude response of a spec at one frequency, as a linear gain.
 *
 * Computed from the biquad coefficients rather than measured from data, so the curve drawn over
 * the spectrum is the filter's actual response and not an estimate that could disagree with the
 * signal it is drawn on.
 */
export function chainMagnitude(spec: FilterSpec, freqHz: number, fs: number): number {
  const sections = chainSections(spec, fs);
  if (sections.length === 0) return 1;
  const w = (2 * Math.PI * freqHz) / fs;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  let mag = 1;
  for (const s of sections) {
    const nr = s.b0 + s.b1 * cw + s.b2 * c2;
    const ni = -(s.b1 * sw + s.b2 * s2);
    const dr = 1 + s.a1 * cw + s.a2 * c2;
    const di = -(s.a1 * sw + s.a2 * s2);
    mag *= Math.hypot(nr, ni) / Math.max(Math.hypot(dr, di), 1e-30); // @lit-ok guard against a zero denominator
  }
  // Forward-backward squares the magnitude; see applyFilterChain.
  return spec.type === 'zeroPhase' ? mag * mag : mag;
}
