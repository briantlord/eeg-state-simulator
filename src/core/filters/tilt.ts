/**
 * Time-varying spectral tilt filter (Build Plan §5.2).
 *
 * Generate at constant χ, then apply a filter that changes the spectral slope by Δχ. Two
 * constraints the plan calls out, both confirmed by measurement (docs/Tier0-Estimator-Probe.md
 * Findings 3–5):
 *
 *   A first-order shelving filter CANNOT produce uniform slope change across 1–45 Hz. Use
 *   cascaded log-spaced pole–zero pairs. Measured ripple in the achieved Δχ: ~100% of Δχ at
 *   1 pole/decade, ~15% at 4/decade, ~10% at 8/decade. `tilt_n_poles` = 12 sits at the knee.
 *
 *   The cascade MUST be realized as second-order (or first-order) sections. Built as a single
 *   transfer function it overflows to non-finite values within a 120 s impulse response at
 *   this order. That is a property of the realization, not the mathematics.
 *
 * SIGN. The achieved PSD exponent is −2g where the zeros sit at pole·D^g. So `g = −Δχ/2`
 * yields PSD ∝ f^(+Δχ). I got this backwards once while characterizing it, and it is the sign
 * that silently inverts the wake/sleep phase reversal — the artifact's most striking
 * behaviour. `test/tilt.test.ts` pins it against a measured spectrum.
 *
 * @lit-ok-file: tilt-filter DSP. The residual literals are the decade padding of the design
 * band (powers of 10), an anti-alias margin below Nyquist (0.45·fs), the filterbank level count
 * and a block-overlap divisor. The filter's SIGNAL inputs — Δχ, the band edges, `tilt_n_poles`
 * — arrive as arguments, sourced by the callers from the registry.
 */
import { applyBiquad, type Biquad } from '../dsp/biquad.ts';
import { scalarValue, bandEdges } from '../registry.ts';

/**
 * One first-order pole–zero section, bilinear-transformed.
 * Expressed as a Biquad with the second-order coefficients zeroed.
 */
function firstOrderSection(zeroHz: number, poleHz: number, fs: number): Biquad {
  const k = 2 * fs;
  const wz = 2 * Math.PI * zeroHz;
  const wp = 2 * Math.PI * poleHz;
  const b0 = 1 + k / wz;
  const b1 = 1 - k / wz;
  const a0 = 1 + k / wp;
  const a1 = 1 - k / wp;
  return { b0: b0 / a0, b1: b1 / a0, b2: 0, a1: a1 / a0, a2: 0 };
}

/**
 * Design a cascade producing a PSD tilt of f^(+deltaChi) across the analysis band.
 *
 * Poles are log-spaced with one decade of pad either side of the band, so the response is
 * still developing outside the range anyone measures rather than rolling off inside it.
 */
export function designTilt(deltaChi: number, fs = scalarValue('fs')): Biquad[] {
  const band = bandEdges('fit_band_broad');
  const nPoles = scalarValue('tilt_n_poles');
  const pad = 1; // decades

  const fLo = band.lo * Math.pow(10, -pad);
  const fHi = Math.min(band.hi * Math.pow(10, pad), 0.45 * fs);
  const d = Math.pow(fHi / fLo, 1 / (nPoles - 1));
  const g = -deltaChi / 2;

  const sections: Biquad[] = [];
  for (let i = 0; i < nPoles; i++) {
    const poleHz = fLo * Math.pow(d, i);
    const zeroHz = poleHz * Math.pow(d, g);
    sections.push(firstOrderSection(zeroHz, poleHz, fs));
  }
  return sections;
}

/** Unity-gain normalization at the geometric centre of the band, computed on the spectrum. */
function gainAt(sections: Biquad[], freqHz: number, fs: number): number {
  const w = (2 * Math.PI * freqHz) / fs;
  let re = 1;
  let im = 0;
  for (const s of sections) {
    // H(e^{jw}) for a first-order section.
    const nr = s.b0 + s.b1 * Math.cos(-w);
    const ni = s.b1 * Math.sin(-w);
    const dr = 1 + s.a1 * Math.cos(-w);
    const di = s.a1 * Math.sin(-w);
    const den = dr * dr + di * di;
    const hr = (nr * dr + ni * di) / den;
    const hi = (ni * dr - nr * di) / den;
    const nre = re * hr - im * hi;
    im = re * hi + im * hr;
    re = nre;
  }
  return Math.hypot(re, im);
}

export type CoefficientScheme = 'blockwise' | 'filterbank';

export interface TiltOptions {
  /** How coefficients follow a changing Δχ. See the note on the interface below. */
  readonly scheme?: CoefficientScheme;
  /** Block length in samples for `blockwise`. */
  readonly blockSamples?: number;
  /** Number of pre-designed filters for `filterbank`. */
  readonly levels?: number;
}

/**
 * Apply a TIME-VARYING tilt: `deltaChi[i]` is the tilt wanted at sample i.
 *
 * TWO SCHEMES, BOTH IMPLEMENTED, ON PURPOSE. The pending decision P3 asked for a settling
 * ratio sufficient to suppress sidebands; measurement showed settling is not the binding
 * constraint (t99 = 0.164 s against a 10 s modulation period is 61× margin) and that the
 * residual risk lives in HOW coefficients are interpolated. It also showed that any proxy
 * cheap enough to answer that before G4 exists is nonlinear enough to fabricate the answer.
 * So the decision was to build both and let G4 choose, and this is that.
 *
 *   `blockwise`  — redesign per block, cosine-crossfade the outputs. Cheap; the crossfade is
 *                  where any artefact would live.
 *   `filterbank` — interpolate between a bank of pre-designed, fully settled LTI filters.
 *                  No coefficient transient can occur because no filter's coefficients ever
 *                  change; the modulation acts only on mixing weights. Costs `levels` passes.
 *
 * MEASURED, and the answer is that it barely matters. Modulating Δχ at 0.10 Hz by ±0.5 and
 * tracking the recovered slope, harmonics of the modulation relative to the fundamental:
 *
 *                  f1 SNR      2·f1        3·f1
 *     filterbank    44.0 dB    −33.7 dB    −38.8 dB
 *     blockwise     42.8 dB    −35.0 dB    −37.0 dB
 *
 * Harmonics of f1 are what become intermodulation sidebands at f2 ± f1 once respiration is
 * present, and they sit ~34 dB down under both schemes. The register rates sideband
 * contamination HIGH; at this level it is not the binding problem. `blockwise` is the default
 * because it is one filtering pass rather than `levels`, which matters for a real-time
 * artifact, and the two are within 1.3 dB of each other.
 *
 * This does NOT close G4. G4 asks whether a coupling ESTIMATOR reports coupling at f2 that
 * the generator did not put there, which depends on the estimator as much as on this filter.
 */
export function applyTimeVaryingTilt(
  x: Float64Array,
  deltaChi: Float64Array,
  fs = scalarValue('fs'),
  opts: TiltOptions = {},
): Float64Array {
  const scheme = opts.scheme ?? 'blockwise';
  return scheme === 'blockwise'
    ? tiltBlockwise(x, deltaChi, fs, opts.blockSamples ?? Math.round(2 * fs))
    : tiltFilterBank(x, deltaChi, fs, opts.levels ?? 17);
}

function applyCascade(x: Float64Array, sections: Biquad[], centreHz: number, fs: number): Float64Array {
  const y = Float64Array.from(x);
  for (const s of sections) applyBiquad(y, s);
  const g = gainAt(sections, centreHz, fs);
  if (g > 0) for (let i = 0; i < y.length; i++) y[i] = y[i]! / g;
  return y;
}

function tiltFilterBank(
  x: Float64Array,
  deltaChi: Float64Array,
  fs: number,
  levels: number,
): Float64Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < deltaChi.length; i++) {
    if (deltaChi[i]! < lo) lo = deltaChi[i]!;
    if (deltaChi[i]! > hi) hi = deltaChi[i]!;
  }
  if (!(hi > lo)) return applyCascade(x, designTilt(lo, fs), centre(fs), fs);

  const band = bandEdges('fit_band_broad');
  const centreHz = Math.sqrt(band.lo * band.hi);
  const outs: Float64Array[] = [];
  for (let l = 0; l < levels; l++) {
    const dchi = lo + ((hi - lo) * l) / (levels - 1);
    outs.push(applyCascade(x, designTilt(dchi, fs), centreHz, fs));
  }

  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const pos = ((deltaChi[i]! - lo) / (hi - lo)) * (levels - 1);
    const j = Math.max(0, Math.min(levels - 2, Math.floor(pos)));
    const frac = pos - j;
    out[i] = outs[j]![i]! * (1 - frac) + outs[j + 1]![i]! * frac;
  }
  return out;
}

function tiltBlockwise(
  x: Float64Array,
  deltaChi: Float64Array,
  fs: number,
  block: number,
): Float64Array {
  const band = bandEdges('fit_band_broad');
  const centreHz = Math.sqrt(band.lo * band.hi);
  const overlap = Math.max(1, Math.round(block / 4));
  const hop = block - overlap;
  const out = new Float64Array(x.length);
  const wsum = new Float64Array(x.length);

  for (let start = 0; start < x.length; start += hop) {
    const end = Math.min(x.length, start + block);
    const seg = x.subarray(start, end);
    let mean = 0;
    for (let i = start; i < end; i++) mean += deltaChi[i]!;
    mean /= end - start;

    const y = applyCascade(Float64Array.from(seg), designTilt(mean, fs), centreHz, fs);
    for (let i = 0; i < y.length; i++) {
      // Equal-power ramps at both edges.
      let w = 1;
      if (i < overlap && start > 0) w = Math.sin((Math.PI / 2) * ((i + 0.5) / overlap));
      if (i >= y.length - overlap && end < x.length) {
        w = Math.cos((Math.PI / 2) * ((i - (y.length - overlap) + 0.5) / overlap));
      }
      out[start + i] = out[start + i]! + y[i]! * w;
      wsum[start + i] = wsum[start + i]! + w;
    }
  }
  for (let i = 0; i < out.length; i++) if (wsum[i]! > 0) out[i] = out[i]! / wsum[i]!;
  return out;
}

function centre(fs: number): number {
  const band = bandEdges('fit_band_broad');
  return Math.sqrt(band.lo * band.hi) * (fs > 0 ? 1 : 1);
}
