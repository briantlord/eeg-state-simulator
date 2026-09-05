/**
 * The live spectrum, with the filter's effect drawn on top of the signal it acts on.
 *
 * WHY A SPECTRUM BELONGS IN THE FILTER PANEL. Every other view in this artifact shows the filter's
 * effect in TIME — Demo 3's invented ringing, the trace itself. A filter is specified in
 * frequency, so a reader adjusting a cutoff is otherwise reasoning about a number with no picture
 * attached. Drawing raw and filtered together makes the stopband something you see rather than
 * something you are told about.
 *
 * THREE THINGS ARE DRAWN AND THEY ARE NOT THE SAME KIND OF OBJECT:
 *
 *   RAW        the PSD of the signal as generated.
 *   FILTERED   the PSD of the signal after the chain. Measured, not predicted.
 *   RESPONSE   the filter's analytic magnitude, from its biquad coefficients.
 *
 * The response curve is deliberately computed from the coefficients rather than as the ratio of
 * the two PSDs. A ratio would be an estimate with its own noise, and it would agree with the
 * filtered curve by construction — so it could never reveal a disagreement between what the
 * filter is specified to do and what it did. Drawn separately, the two can be compared.
 *
 * @lit-ok-file: canvas layout geometry and axis decades — margins, tick lengths, label offsets,
 * grid line counts. Pixels and decade markers, not signal parameters. Every frequency and gain
 * plotted arrives as data.
 */
import { welch } from '../analysis/psd.ts';
import { fft } from '../core/dsp/fft.ts';
import { applyFilterChain, chainMagnitude, type FilterSpec } from '../core/filters/hpf.ts';
import { bandEdges, scalarValue } from '../core/registry.ts';

export interface SpectrumOptions {
  /** The channel to analyse, already referenced. Unfiltered. */
  readonly raw: Float64Array;
  readonly fs: number;
  readonly spec: FilterSpec;
  /** Frequency axis limits, in Hz. */
  readonly fMin: number;
  readonly fMax: number;
  /** Draw the filtered curve and the response. False while both ends are off. */
  readonly showFiltered: boolean;
  /** Ordinary Welch, one complete-record periodogram, or the live multiresolution combination. */
  readonly estimator?: 'welch' | 'full-record' | 'hybrid';
}

const CSS = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Where a frequency sits on a log axis, in [0, 1]. */
export function fToUnit(f: number, fMin: number, fMax: number): number {
  return (Math.log10(Math.max(f, fMin)) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin));
}

/** Inverse of `fToUnit` — used to turn a drag position back into a cutoff. */
export function unitToF(u: number, fMin: number, fMax: number): number {
  const lo = Math.log10(fMin);
  return 10 ** (lo + Math.max(0, Math.min(1, u)) * (Math.log10(fMax) - lo));
}

export interface SpectrumLayout {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The plot rectangle, so the caller can map pointer positions to frequencies. */
export function spectrumLayout(canvas: HTMLCanvasElement): SpectrumLayout {
  return { left: 46, right: canvas.clientWidth - 10, top: 8, bottom: canvas.clientHeight - 26 };
}

/**
 * Hann-windowed periodogram of one complete record, zero-padded to the next radix-2 FFT length.
 *
 * Zero padding gives enough plotted bins for a readable log axis; it does not create temporal
 * resolution. The interface therefore states 1 / record duration separately. Welch's ordinary
 * four-second segments cannot represent 0.005-0.1 Hz at all, so the long view needs a distinct,
 * explicit estimator rather than silently stretching that curve leftward.
 */
export function fullRecordPeriodogram(x: Float64Array, fs: number): {
  readonly freqs: Float64Array;
  readonly power: Float64Array;
} {
  if (x.length < 2) return { freqs: new Float64Array(), power: new Float64Array() };
  const nfft = 2 ** Math.ceil(Math.log2(x.length));
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let mean = 0;
  for (let i = 0; i < x.length; i++) mean += x[i]!;
  mean /= x.length;
  let windowPower = 0;
  for (let i = 0; i < x.length; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (x.length - 1)));
    re[i] = (x[i]! - mean) * w;
    windowPower += w * w;
  }
  fft(re, im, false);
  const nBins = nfft / 2 + 1;
  const freqs = new Float64Array(nBins);
  const power = new Float64Array(nBins);
  for (let i = 0; i < nBins; i++) {
    const squared = re[i]! * re[i]! + im[i]! * im[i]!;
    freqs[i] = (i * fs) / nfft;
    power[i] = (i === 0 || i === nBins - 1 ? squared : 2 * squared) / (fs * windowPower);
  }
  return { freqs, power };
}

/** Linear interpolation in frequency and logarithmic power. */
function interpolatedPower(
  psd: { freqs: Float64Array; power: Float64Array },
  frequency: number,
): number {
  const step = psd.freqs[1]! - psd.freqs[0]!;
  const position = frequency / step;
  const lo = Math.max(0, Math.min(psd.power.length - 1, Math.floor(position)));
  const hi = Math.max(0, Math.min(psd.power.length - 1, lo + 1));
  const mix = Math.max(0, Math.min(1, position - lo));
  const a = Math.log(Math.max(psd.power[lo]!, Number.MIN_VALUE));
  const b = Math.log(Math.max(psd.power[hi]!, Number.MIN_VALUE));
  return Math.exp(a + mix * (b - a));
}

/**
 * Longest radix-2 Welch segment that still gives at least four 50%-overlapped segments.
 *
 * A single complete-record periodogram has fine bin spacing but its variance does not fall as the
 * record grows. Requiring four segments gives the slow-frequency display actual averaging. The
 * 8192-sample ceiling is 32 seconds at the registered 256 Hz sampling rate.
 */
export function hybridLowNperseg(sampleCount: number): number {
  if (sampleCount < 2) return 1;
  const available = 2 ** Math.floor(Math.log2(sampleCount));
  const highNper = Math.min(1 << 10, available);
  const minSegments = scalarValue('spectrum_low_min_segments');
  // With 50% overlap, nSeg = floor(2N / nperseg - 1). Solve that inequality for nperseg.
  const segmentLimit = Math.max(2, Math.floor((2 * sampleCount) / (minSegments + 1)));
  const varianceLimited = 2 ** Math.floor(Math.log2(segmentLimit));
  return Math.min(available, Math.max(highNper, varianceLimited));
}

/** A three-bin triangular average of linear power; frequencies are unchanged. */
function smoothAdjacentBins(psd: { freqs: Float64Array; power: Float64Array }): {
  readonly freqs: Float64Array;
  readonly power: Float64Array;
} {
  const radius = scalarValue('spectrum_low_smooth_radius_bins');
  const power = new Float64Array(psd.power.length);
  for (let i = 0; i < power.length; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(power.length - 1, i + radius);
    let sum = 0;
    let weight = 0;
    for (let j = lo; j <= hi; j++) {
      const w = radius + 1 - Math.abs(j - i);
      sum += w * psd.power[j]!;
      weight += w;
    }
    power[i] = sum / weight;
  }
  return { freqs: psd.freqs, power };
}

/**
 * A variance-controlled multiresolution live spectrum.
 *
 * Long-window Welch supplies the sub-1-Hz estimate and is lightly frequency-averaged. Ordinary
 * four-second Welch supplies the denser set of independent time averages above 1 Hz. Their overlap
 * is blended in log power with a smoothstep, so the estimator change is not drawn as an artificial
 * spectral edge. We deliberately do not draw complete-record Fourier bins below the long-window
 * resolution: their dramatic tooth-to-tooth variation is estimator variance, not useful detail.
 */
export function hybridSpectrum(x: Float64Array, fs: number): {
  readonly freqs: Float64Array;
  readonly power: Float64Array;
} {
  if (x.length < 2) return { freqs: new Float64Array(), power: new Float64Array() };
  const available = 2 ** Math.floor(Math.log2(x.length));
  const highNper = Math.min(1 << 10, available);
  const lowNper = hybridLowNperseg(x.length);
  const low = smoothAdjacentBins(welch(x, fs, lowNper, lowNper / 2));
  const high = welch(x, fs, highNper, highNper / 2);
  if (low.freqs.length < 2 || high.freqs.length < 2) return low;

  const blend = bandEdges('spectrum_hybrid_blend');
  const blendLo = blend.lo;
  const blendHi = blend.hi;
  const freqs: number[] = [];
  const power: number[] = [];

  for (let i = 0; i < low.freqs.length; i++) {
    const f = low.freqs[i]!;
    if (f > blendHi) break;
    let p = low.power[i]!;
    if (f > blendLo) {
      const u = (f - blendLo) / (blendHi - blendLo);
      const smooth = u * u * (3 - 2 * u);
      const highPower = interpolatedPower(high, f);
      p = Math.exp(
        (1 - smooth) * Math.log(Math.max(p, Number.MIN_VALUE)) +
        smooth * Math.log(Math.max(highPower, Number.MIN_VALUE)),
      );
    }
    freqs.push(f);
    power.push(p);
  }
  for (let i = 0; i < high.freqs.length; i++) {
    if (high.freqs[i]! <= blendHi) continue;
    freqs.push(high.freqs[i]!);
    power.push(high.power[i]!);
  }
  return { freqs: Float64Array.from(freqs), power: Float64Array.from(power) };
}

export function drawSpectrum(canvas: HTMLCanvasElement, o: SpectrumOptions): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const paper = CSS('--paper') || '#f7f5ef';
  const rule = CSS('--paper-rule') || '#e0dbcd';
  const ruleMajor = CSS('--paper-rule-major') || '#cfc7b3';
  const ink = CSS('--pen-trace') || '#1a1a18';
  const faint = CSS('--ink-faint') || '#8b877c';
  const accent = CSS('--pen-event') || '#a8322a';

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, cssW, cssH);

  const { left, right, top, bottom } = spectrumLayout(canvas);
  const plotW = right - left;
  const plotH = bottom - top;

  // The live hybrid uses long-window averaged estimates below 1 Hz and ordinary Welch above it.
  // Keeping the estimator explicit prevents a low-resolution curve from being stretched into
  // frequencies it never measured and prevents raw periodogram variance from being drawn as EEG.
  const welchNper = Math.min(1 << 10, 1 << Math.floor(Math.log2(o.raw.length)));
  const estimate = (signal: Float64Array) => {
    if (o.estimator === 'full-record') return fullRecordPeriodogram(signal, o.fs);
    if (o.estimator === 'hybrid') return hybridSpectrum(signal, o.fs);
    return welch(signal, o.fs, welchNper, welchNper / 2);
  };
  const rawPsd = estimate(o.raw);
  const filtPsd = o.showFiltered ? estimate(applyFilterChain(o.raw, o.spec, o.fs)) : null;
  // ZERO PADDING CHANGES PLOTTED BIN SPACING, NOT INFORMATION. A complete-record estimate has
  // no independent frequency information below 1/T even if its padded FFT contains bins there.
  const resolvedFromHz = o.estimator === 'full-record'
    ? o.fs / o.raw.length
    : o.estimator === 'hybrid'
      ? o.fs / hybridLowNperseg(o.raw.length)
      : o.fs / welchNper;

  // Power axis from the RAW spectrum alone, so the axis does not jump as the filter is dragged.
  // A filtered curve that leaves the bottom of the plot is information, not a scaling problem.
  let pMax = -Infinity;
  for (let i = 0; i < rawPsd.freqs.length; i++) {
    const f = rawPsd.freqs[i]!;
    if (f < Math.max(o.fMin, resolvedFromHz) || f > o.fMax) continue;
    const p = rawPsd.power[i]!;
    if (p > 0) pMax = Math.max(pMax, Math.log10(p));
  }
  if (!Number.isFinite(pMax)) return;
  const decades = 7; // @lit-ok vertical span of the power axis, in decades
  const pMin = pMax - decades;
  const yOf = (p: number) =>
    bottom - ((Math.log10(Math.max(p, 1e-30)) - pMin) / decades) * plotH;
  const xOf = (f: number) => left + fToUnit(f, o.fMin, o.fMax) * plotW;

  // --- decade grid ---------------------------------------------------------
  ctx.lineWidth = 1;
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = faint;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let d = Math.ceil(Math.log10(o.fMin)); d <= Math.log10(o.fMax); d++) {
    for (let m = 1; m < 10; m++) {
      const f = m * 10 ** d;
      if (f < o.fMin || f > o.fMax) continue;
      const x = Math.round(xOf(f)) + 0.5;
      ctx.strokeStyle = m === 1 ? ruleMajor : rule;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      if (m === 1) ctx.fillText(f >= 1 ? String(f) : String(f), x, bottom + 4);
    }
  }
  ctx.strokeStyle = ruleMajor;
  ctx.strokeRect(left + 0.5, top + 0.5, plotW, plotH);

  ctx.save();
  ctx.translate(12, (top + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('log power', 0, 0);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.fillText('Hz', (left + right) / 2, bottom + 14);

  // --- unresolved region --------------------------------------------------
  // The analytic filter exists below 1/T, but this finite signal record does not contain enough
  // time to estimate power there. Mark that distinction instead of fabricating a PSD extension.
  if (resolvedFromHz > o.fMin) {
    const xResolved = xOf(Math.min(resolvedFromHz, o.fMax));
    ctx.fillStyle = faint;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(left, top, Math.max(0, xResolved - left), plotH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = faint;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(Math.round(xResolved) + 0.5, top);
    ctx.lineTo(Math.round(xResolved) + 0.5, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = faint;
    ctx.font = '8px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`1/T ${resolvedFromHz.toFixed(3)} Hz`, xResolved + 3, bottom - 3);
  }

  const curve = (psd: { freqs: Float64Array; power: Float64Array }, colour: string, w: number) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < psd.freqs.length; i++) {
      const f = psd.freqs[i]!;
      if (f < Math.max(o.fMin, resolvedFromHz) || f > o.fMax) continue;
      const x = xOf(f);
      const y = Math.max(top, Math.min(bottom, yOf(psd.power[i]!)));
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  // --- stopband shading, so the removed region reads at a glance ------------
  if (o.showFiltered) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.07;
    if (o.spec.highpassHz !== null) {
      ctx.fillRect(left, top, Math.max(0, xOf(o.spec.highpassHz) - left), plotH);
    }
    if (o.spec.lowpassHz !== null) {
      const x = xOf(o.spec.lowpassHz);
      ctx.fillRect(x, top, Math.max(0, right - x), plotH);
    }
    ctx.globalAlpha = 1;
  }

  curve(rawPsd, faint, 1);
  if (filtPsd) curve(filtPsd, ink, 1.4);

  // --- the filter's analytic response, on its own scale --------------------
  if (o.showFiltered) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const steps = 240; // @lit-ok points along the response curve
    for (let i = 0; i <= steps; i++) {
      const f = unitToF(i / steps, o.fMin, o.fMax);
      const g = chainMagnitude(o.spec, f, o.fs);
      // Response plotted over the top three decades of the panel: full gain at the top, -60 dB
      // at the bottom of that span, so it reads as an overlay rather than competing with power.
      const gdb = Math.max(-60, 20 * Math.log10(Math.max(g, 1e-12)));
      const y = top + (-gdb / 60) * plotH * 0.5;
      if (i === 0) ctx.moveTo(xOf(f), y);
      else ctx.lineTo(xOf(f), y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // --- cutoff handles ------------------------------------------------------
  const handle = (f: number, label: string) => {
    const x = Math.round(xOf(f)) + 0.5;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(x - 5, top);
    ctx.lineTo(x + 5, top);
    ctx.lineTo(x, top + 8);
    ctx.closePath();
    ctx.fill();
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = x > right - 40 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${label} ${f < 0.1 ? f.toFixed(3) : f < 1 ? f.toFixed(2) : f.toFixed(f < 10 ? 1 : 0)} Hz`,
      x > right - 40 ? x - 6 : x + 6, top + 10);
  };
  if (o.spec.highpassHz !== null) handle(o.spec.highpassHz, 'HP');
  if (o.spec.lowpassHz !== null) handle(o.spec.lowpassHz, 'LP');

  // --- legend --------------------------------------------------------------
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = faint;
  ctx.fillText('raw', right - 6, top + 2);
  if (o.showFiltered) {
    ctx.fillStyle = ink;
    ctx.fillText('filtered', right - 34, top + 2);
  }
}
