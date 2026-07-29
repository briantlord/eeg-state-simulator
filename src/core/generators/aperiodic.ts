/**
 * Aperiodic background with a knee (Build Plan 3.2).
 *
 *     L(f) = b - log10(k + f^chi)     i.e.   P(f) = 10^b / (k + f^chi)
 *
 * "A pure power law is wrong here and the error is not small." `k` encodes the ~20 Hz knee
 * only; the ~45 Hz knee is documented and unmodelled at every tier (DECISIONS D3).
 *
 * TWO SYNTHESIS PATHS, and the default is the single-FFT one.
 *
 * The Build Plan specifies "FFT synthesis in overlapping blocks with cosine crossfade", and
 * that path is kept for the live streaming buffer. But blocks are INDEPENDENT realizations,
 * so overlap-add leaves a residue at the block rate no matter how good the crossfade: an
 * equal-power sin/cos fade keeps the variance flat through the join, and the local SPECTRUM
 * still wobbles. Measured, that residue landed exactly on a frequency G4 depends on. Whenever
 * the run length is known — every export, every gate — one transform is used instead and
 * there is no block rate to leak at.
 *
 * The crossfade in the block path is equal-power for a reason worth keeping: a linear
 * w/(1-w) fade over independent blocks gives variance w^2 + (1-w)^2, dipping to 0.5 at the
 * midpoint, i.e. a periodic amplitude ripple at the block rate. sin/cos gives exactly 1.
 */
import { fft } from '../dsp/fft.ts';
import type { Rng } from '../rng/xoshiro128pp.ts';
import { scalarValue } from '../registry.ts';

export interface AperiodicParams {
  /** Aperiodic exponent. Positive means falling power with frequency. */
  readonly chi: number;
  /** Knee parameter. Knee frequency is k^(1/chi). */
  readonly k: number;
  /** Target RMS in microvolts, over the synthesis band. */
  readonly rmsUv: number;
}

/**
 * One block of shaped noise, generated directly in the frequency domain: uniform random
 * phase, amplitude sqrt(P(f)). This hits the target PSD exactly, rather than approximately
 * as filtering white noise would.
 */
function synthBlock(rng: Rng, n: number, fs: number, p: AperiodicParams): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const nyq = n >> 1;

  for (let i = 1; i < nyq; i++) {
    const f = (i * fs) / n;
    // P(f) = 1 / (k + f^chi); the 10^b offset is folded into the RMS normalization below.
    const amp = Math.sqrt(1 / (p.k + Math.pow(f, p.chi)));
    const phase = rng.uniform(0, 2 * Math.PI);
    const a = amp * Math.cos(phase);
    const b = amp * Math.sin(phase);
    // Hermitian symmetry, so the inverse transform is real.
    re[i] = a;
    im[i] = b;
    re[n - i] = a;
    im[n - i] = -b;
  }
  // DC and Nyquist are real. DC is zeroed: a non-zero mean is not part of the model, and it
  // would otherwise be set by an arbitrary draw at f = 0 where P(f) = 1/k is finite.
  re[0] = 0;
  im[0] = 0;
  re[nyq] = 0;
  im[nyq] = 0;

  fft(re, im, true);
  return re;
}

/**
 * Continuous aperiodic signal of `nSamples`, in microvolts.
 *
 * The stream is a function of `(rng, nSamples, params)` alone, so slicing it into epochs is
 * exactly equivalent to generating the epochs together -- which is what keeps the record the
 * harness stitches free of block-rate artefacts.
 */
export function synthesizeAperiodic(
  rng: Rng,
  nSamples: number,
  params: AperiodicParams,
  fs = scalarValue('fs'),
  block = scalarValue('synth_block'),
  overlap = scalarValue('synth_overlap'),
  /** Force the block path. Only the live streaming buffer should need this. */
  forceBlocks = false,
): Float64Array {
  // SINGLE-FFT PATH — the default whenever the run length is known.
  //
  // Overlap-added blocks leave a residue at the BLOCK RATE even with an equal-power
  // crossfade, because consecutive blocks are independent realizations: the variance is flat
  // through the join but the local spectrum still wobbles. With synth_block 4096 and
  // synth_overlap 1024 the hop is 3072 samples = 12 s, depositing a comb at k/12 Hz.
  //
  // g4_f2 = 0.25 Hz is EXACTLY harmonic 3 of that comb. Measured, the recovered chi(t) carried
  // a spurious 0.25 Hz line nine times larger than the 0.10 Hz baseline with no modulation
  // injected at all — on the arm of G4 that must show NO coupling. g4_f1 = 0.10 Hz is not a
  // harmonic (0.10 x 12 = 1.2) and was clean, which is exactly how the defect stayed hidden.
  //
  // Synthesizing the whole run in one transform has no block rate to leak at.
  if (!forceBlocks) {
    const n2 = nextPow2(nSamples);
    return normalizeRms(synthBlock(rng, n2, fs, params).subarray(0, nSamples), params.rmsUv);
  }

  if (overlap * 2 > block) throw new Error('aperiodic: overlap must not exceed half the block');
  const hop = block - overlap;
  const out = new Float64Array(nSamples);

  // Equal-power ramps, precomputed.
  const fadeIn = new Float64Array(overlap);
  const fadeOut = new Float64Array(overlap);
  for (let i = 0; i < overlap; i++) {
    const t = (Math.PI / 2) * ((i + 0.5) / overlap);
    fadeIn[i] = Math.sin(t);
    fadeOut[i] = Math.cos(t);
  }

  let pos = 0;
  let prev: Float64Array | null = null;
  while (pos < nSamples) {
    const cur = synthBlock(rng, block, fs, params);

    if (prev === null) {
      const take = Math.min(hop, nSamples - pos);
      out.set(cur.subarray(0, take), pos);
    } else {
      // Crossfade the overlap: the tail of `prev` against the head of `cur`.
      for (let i = 0; i < overlap && pos + i < nSamples; i++) {
        out[pos + i] = prev[hop + i]! * fadeOut[i]! + cur[i]! * fadeIn[i]!;
      }
      const bodyStart = pos + overlap;
      const take = Math.min(hop - overlap, nSamples - bodyStart);
      if (take > 0) out.set(cur.subarray(overlap, overlap + take), bodyStart);
    }

    prev = cur;
    pos += hop;
  }

  return normalizeRms(out, params.rmsUv);
}

/**
 * Scale in place to a target RMS, measured over a FIXED-LENGTH PREFIX.
 *
 * Measuring over the whole array would make the gain a function of how many samples were
 * requested: a 30 s export and a 300 s export of the same seed would be scaled differently,
 * so `snr_nominal` calibrated on one would not transfer to the other, and epoch 0 of a
 * 1-epoch run would not equal epoch 0 of a 10-epoch run. Continuity survives either way — a
 * global gain does not put a step at a boundary — but absolute amplitude is exactly what
 * seam 5 says must be stable.
 *
 * The prefix is one epoch, which every run has by construction.
 */
export function normalizeRms(
  x: Float64Array,
  targetRms: number,
  prefix = scalarValue('fs') * scalarValue('epoch_display'),
): Float64Array {
  const n = Math.min(x.length, prefix);
  let ss = 0;
  for (let i = 0; i < n; i++) ss += x[i]! * x[i]!;
  const rms = Math.sqrt(ss / n);
  if (rms === 0) return x;
  const g = targetRms / rms;
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * g;
  return x;
}

/** Smallest power of two at least n. */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Knee frequency implied by (k, chi): f_knee = k^(1/chi). */
export function kneeFrequencyOf(k: number, chi: number): number {
  return Math.pow(k, 1 / chi);
}
