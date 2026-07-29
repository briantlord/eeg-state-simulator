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
import { applyBiquad, butterworthQs, highpass, type Biquad } from '../dsp/biquad.ts';
import { scalarValue } from '../registry.ts';

export type FilterType = 'zeroPhase' | 'causal';

export function highpassSections(cutoffHz: number, fs: number, order = 4): Biquad[] {
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
