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
import { applyFilterChain, chainMagnitude, type FilterSpec } from '../core/filters/hpf.ts';

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

  // Welch over the whole visible buffer. 4 s segments: enough resolution to see the low end,
  // enough averaging that the curve is readable rather than a hairball.
  const nper = Math.min(1 << 10, 1 << Math.floor(Math.log2(o.raw.length)));
  const rawPsd = welch(o.raw, o.fs, nper, nper / 2);
  const filtPsd = o.showFiltered
    ? welch(applyFilterChain(o.raw, o.spec, o.fs), o.fs, nper, nper / 2)
    : null;

  // Power axis from the RAW spectrum alone, so the axis does not jump as the filter is dragged.
  // A filtered curve that leaves the bottom of the plot is information, not a scaling problem.
  let pMax = -Infinity;
  for (let i = 0; i < rawPsd.freqs.length; i++) {
    const f = rawPsd.freqs[i]!;
    if (f < o.fMin || f > o.fMax) continue;
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

  const curve = (psd: { freqs: Float64Array; power: Float64Array }, colour: string, w: number) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < psd.freqs.length; i++) {
      const f = psd.freqs[i]!;
      if (f < o.fMin || f > o.fMax) continue;
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
    ctx.fillText(`${label} ${f < 1 ? f.toFixed(2) : f.toFixed(f < 10 ? 1 : 0)} Hz`,
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
