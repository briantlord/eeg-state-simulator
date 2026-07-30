/**
 * ECG, and the respiratory sinus arrhythmia that ties it to the respiration belt.
 *
 * A TIER-0-STYLE PREFIX OF T1-M5, not the milestone. The Build Plan schedules cardiac mechanisms
 * and the heartbeat-evoked potential for T1-M5 (4 days); what exists here is the crude
 * implementation behind a stable interface that the project's "prefix not placeholder" rule asks
 * for, so the trace can show a cardiac channel now and the real work can replace the body of one
 * function later.
 *
 * TRANSCRIBED, NOT INVENTED. The risk register names "rebuilding solved generators" explicitly
 * and prescribes "transcribe, cite, validate against the originals". The form is McSharry,
 * Clifford, Tarassenko & Smith (2003) — five Gaussians (P, Q, R, S, T) placed at fixed angles on
 * the cardiac cycle. Their paper integrates three coupled ODEs to move a point around a limit
 * cycle; evaluating the same Gaussian sum directly on beat phase is the standard reduction and
 * gives the same waveform without the integrator.
 *
 * THE THIRD STEP IS NOT DONE. Nothing here has been validated against `neurokit2.ecg_simulate` or
 * a real recording, and `ecg_wave_shape`'s note says so. No gate reads any of it. TODO(T1-M5).
 *
 * WHY RSA IS IN THE FIRST VERSION rather than deferred with everything else: it is the reason the
 * two new traces belong on one screen. The heart speeds on inspiration and slows on expiration, so
 * the ECG is not independent of the belt above it, and a viewer watching both should be able to
 * see that. It is driven from the SAME respiratory phase the EEG's respiratory mechanisms use, so
 * the three cannot drift apart.
 */
import { Rng } from '../rng/xoshiro128pp.ts';
import { provisionalValue, scalarValue, procedureText } from '../registry.ts';

export interface CardiacResult {
  /** Surface ECG in microvolts, on a lead-II-like derivation. */
  readonly ecg: Float64Array;
  /** R-peak times in seconds. The event list a HEP analysis would need at T1-M5. */
  readonly rPeaks: readonly number[];
  /** Achieved mean rate, for the sidecar. */
  readonly meanHrBpm: number;
}

/** One Gaussian of the PQRST complex: phase from R in cycles, relative amplitude, width. */
interface Wave {
  readonly phase: number;
  readonly amp: number;
  readonly width: number;
}

/**
 * The five waves, parsed from `ecg_wave_shape`.
 *
 * READ FROM THE REGISTRY RATHER THAN WRITTEN HERE, because fifteen numbers in source would be
 * fifteen unregistered constants — exactly what the literal linter and seam 6 exist to prevent.
 * They are one row because they are one model: fitting them independently would be meaningless.
 */
function waves(): Wave[] {
  const text = procedureText('ecg_wave_shape');
  // "P (-0.20, +0.12, 0.030), Q (-0.025, -0.16, 0.0060), ..."
  const out: Wave[] = [];
  for (const m of text.matchAll(/\(([-+0-9.]+),\s*([-+0-9.]+),\s*([-+0-9.]+)\)/g)) { // @lit-ok regex character classes; the masker does not parse regex (D15)
    out.push({ phase: Number(m[1]), amp: Number(m[2]), width: Number(m[3]) }); // @lit-ok capture-group indices
  }
  if (out.length !== 5) { // @lit-ok the PQRST complex has five waves, by definition of the model
    throw new Error(
      `ecg_wave_shape must describe five waves, parsed ${out.length}. The row is the source of ` +
        'truth for the morphology and this parser must not silently accept a partial read.',
    );
  }
  return out;
}

/**
 * Synthesize a surface ECG.
 *
 * `respPhase` is the respiration phase in radians, sample-aligned, and drives RSA. Passing it
 * rather than re-deriving respiration here is what keeps the cardiac and respiratory channels
 * consistent with each other and with the EEG's respiratory mechanisms.
 */
export function synthesizeEcg(
  seed: number,
  nSamples: number,
  respPhase: Float64Array,
  fs = scalarValue('fs'),
): CardiacResult {
  const rng = Rng.substream(seed, 'cardiac/ecg');
  const hrMean = provisionalValue('hr_mean');
  const hrSd = provisionalValue('hr_sd');
  const rsa = provisionalValue('rsa_depth');
  const rAmp = provisionalValue('ecg_r_amp');
  const shape = waves();

  const out = new Float64Array(nSamples);
  const rPeaks: number[] = [];

  // Beats are scheduled by walking the RR interval forward, so the rate can vary WITHIN a beat's
  // neighbourhood without the schedule drifting — the alternative, drawing all onsets up front,
  // cannot respond to a respiratory phase that is itself irregular.
  let t = rng.uniform(0, 60 / hrMean); // @lit-ok seconds per minute
  while (t < nSamples / fs) {
    rPeaks.push(t);

    const i = Math.min(nSamples - 1, Math.max(0, Math.round(t * fs)));
    // RSA: shorter RR (faster heart) on inspiration. Plus a non-respiratory HRV term, so the
    // variability is not purely respiratory — real HRV is not.
    const hrNow = hrMean * (1 + rsa * Math.sin(respPhase[i] ?? 0)) + hrSd * rng.normal();
    const rr = 60 / Math.max(20, hrNow); // @lit-ok floor on instantaneous rate, guarding the division
    t += rr;
  }

  // Each beat's waveform spans its own RR, so morphology scales with rate the way a real complex
  // roughly does rather than staying a fixed number of milliseconds at every heart rate.
  for (let b = 0; b < rPeaks.length; b++) {
    const tR = rPeaks[b]!;
    const rrPrev = b > 0 ? tR - rPeaks[b - 1]! : 60 / hrMean; // @lit-ok seconds per minute
    const rrNext = b + 1 < rPeaks.length ? rPeaks[b + 1]! - tR : 60 / hrMean; // @lit-ok seconds per minute

    for (const w of shape) {
      const rr = w.phase < 0 ? rrPrev : rrNext;
      const centre = tR + w.phase * rr;
      const sigma = w.width * rr;
      const lo = Math.max(0, Math.round((centre - 4 * sigma) * fs)); // @lit-ok +/-4 sigma covers the Gaussian
      const hi = Math.min(nSamples - 1, Math.round((centre + 4 * sigma) * fs)); // @lit-ok as above
      for (let i = lo; i <= hi; i++) {
        const dt = (i / fs - centre) / sigma;
        out[i] = out[i]! + rAmp * w.amp * Math.exp(-0.5 * dt * dt);
      }
    }
  }

  const meanHrBpm = rPeaks.length > 1
    ? (60 * (rPeaks.length - 1)) / (rPeaks[rPeaks.length - 1]! - rPeaks[0]!) // @lit-ok seconds per minute
    : hrMean;

  return { ecg: out, rPeaks, meanHrBpm };
}
