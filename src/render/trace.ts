/**
 * The scrolling trace (Build Plan §8).
 *
 * "Display: 30 s epochs by default (the AASM scoring epoch), FIXED µV/mm scale with a
 * calibration bar. NEVER AUTOSCALE. The amplitude difference between N3 delta and waking
 * alpha is one of the most important facts on screen."
 *
 * Autoscaling would destroy that difference silently and make every state look the same
 * height, which is the single most misleading thing this display could do.
 *
 * Canvas 2D, not SVG: 19 traces × 7680 samples is 146k points, and min/max decimation to
 * pixel columns is the only way to draw that at frame rate. Decimation preserves the
 * ENVELOPE — a spike narrower than one pixel column still reaches the top of that column —
 * where naive subsampling would drop it entirely.
 *
 * @lit-ok-file: canvas layout geometry — margins, gutter widths, tick lengths, label offsets,
 * a grid-line stride, a hairline alpha. Pixels, not signal. The one number that IS a signal
 * scale, µV/mm, arrives as `sensitivityUvPerMm` and is sourced by the caller; `display_px_per_mm`
 * is read via scalarValue.
 */
import { scalarValue } from '../core/registry.ts';

export interface TraceEvent {
  readonly onset: number;
  readonly duration: number;
  readonly type: string;
}

export interface TraceOptions {
  /** [channel][sample], microvolts. */
  readonly channels: readonly Float64Array[];
  readonly labels: readonly string[];
  readonly fs: number;
  /** Microvolts per millimetre of screen. Fixed; never derived from the data. */
  readonly sensitivityUvPerMm: number;
  /** Assumed physical pixel density, for the µV/mm claim to mean anything. */
  readonly pxPerMm: number;
  readonly events?: readonly TraceEvent[];
  /** Seconds from the start of the buffer to display. */
  readonly windowS: number;
  readonly tOffsetS: number;
}

const CSS = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function drawTrace(canvas: HTMLCanvasElement, o: TraceOptions): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
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
  const inkFaint = CSS('--ink-faint') || '#8b877c';
  const penEvent = CSS('--pen-event') || '#a8322a';

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, cssW, cssH);

  const left = 58;
  const right = cssW - 12;
  const plotW = right - left;
  const n = o.channels.length;
  const laneH = cssH / n;

  // --- time grid: one second per minor rule, five per major -----------------
  ctx.lineWidth = 1;
  for (let s = 0; s <= o.windowS; s++) {
    const x = left + (s / o.windowS) * plotW;
    ctx.strokeStyle = s % 5 === 0 ? ruleMajor : rule;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, cssH);
    ctx.stroke();
  }

  // --- event bands, drawn under the traces ----------------------------------
  if (o.events?.length) {
    ctx.fillStyle = penEvent;
    ctx.globalAlpha = 0.12;
    for (const ev of o.events) {
      const a = ev.onset - o.tOffsetS;
      const b = a + ev.duration;
      if (b < 0 || a > o.windowS) continue;
      const xa = left + (Math.max(0, a) / o.windowS) * plotW;
      const xb = left + (Math.min(o.windowS, b) / o.windowS) * plotW;
      ctx.fillRect(xa, 0, Math.max(1, xb - xa), cssH);
    }
    ctx.globalAlpha = 1;
  }

  // --- traces ---------------------------------------------------------------
  //
  // FIXED SCALE. pxPerUv is a property of the display settings alone; nothing about the data
  // enters it. That is what makes N3 visibly larger than wake rather than identically tall.
  const pxPerUv = o.pxPerMm / o.sensitivityUvPerMm;
  const start = Math.round(o.tOffsetS * o.fs);
  const count = Math.round(o.windowS * o.fs);

  ctx.lineWidth = 1;
  ctx.strokeStyle = ink;
  for (let c = 0; c < n; c++) {
    const mid = laneH * (c + 0.5);
    const data = o.channels[c]!;
    ctx.beginPath();
    for (let px = 0; px < plotW; px++) {
      const i0 = start + Math.floor((px / plotW) * count);
      const i1 = start + Math.floor(((px + 1) / plotW) * count);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = i0; i < i1 && i < data.length; i++) {
        const v = data[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (lo === Infinity) continue;
      // NEGATIVE UP: the clinical convention, applied HERE and only here. The generator works
      // in standard polarity; inverting in both places would restore the wrong sign silently.
      const yTop = mid - hi * pxPerUv;
      const yBot = mid - lo * pxPerUv;
      const x = left + px + 0.5;
      ctx.moveTo(x, Math.max(0, Math.min(cssH, yTop)));
      ctx.lineTo(x, Math.max(0, Math.min(cssH, yBot)));
    }
    ctx.stroke();

    // Lane separator and montage label.
    ctx.strokeStyle = rule;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(laneH * (c + 1)) + 0.5);
    ctx.lineTo(right, Math.round(laneH * (c + 1)) + 0.5);
    ctx.stroke();
    ctx.strokeStyle = ink;

    ctx.fillStyle = inkFaint;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.labels[c] ?? '', left - 8, mid);
  }

  drawCalibrationBar(ctx, left, cssH, pxPerUv, o.sensitivityUvPerMm, inkFaint, ink);
}

/**
 * The calibration pulse: a known amplitude drawn to the same scale as the traces.
 *
 * Without it "fixed µV/mm" is an unverifiable claim. With it, anyone can measure the trace
 * against a bar of stated height, which is what the paper chart it imitates was for.
 */
function drawCalibrationBar(
  ctx: CanvasRenderingContext2D,
  left: number,
  h: number,
  pxPerUv: number,
  sensitivity: number,
  faint: string,
  ink: string,
): void {
  const uv = scalarValue('display_cal_pulse_amp');
  const px = uv * pxPerUv;
  const x = 14;
  const y = h - 18;

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - px);
  ctx.moveTo(x - 4, y);
  ctx.lineTo(x + 4, y);
  ctx.moveTo(x - 4, y - px);
  ctx.lineTo(x + 4, y - px);
  ctx.stroke();

  ctx.fillStyle = faint;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${uv} µV`, x + 7, y);
  ctx.fillText(`${sensitivity} µV/mm`, x + 7, y + 11);
}
