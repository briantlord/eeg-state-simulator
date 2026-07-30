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

/**
 * A non-EEG channel drawn below the montage: respiration belt, ECG.
 *
 * SCALED PER LANE, which is the one place this file is allowed to autoscale. The "never
 * autoscale" rule exists so the amplitude difference between N3 delta and waking alpha survives
 * on screen — it is about comparing EEG to EEG. These are different physical quantities: the
 * respiration belt has no meaningful absolute unit at all, and an ECG R wave is ~1000 uV, which
 * at 7 uV/mm would be 14 cm tall and would flatten every EEG trace beside it. Each lane states
 * its own scale, so nothing is claimed that is not shown.
 */
export interface AuxChannel {
  readonly label: string;
  readonly data: Float64Array;
  /** Printed beside the lane, e.g. "µV" or "a.u." */
  readonly unit: string;
}

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
  /** Respiration, ECG: drawn below a firm boundary, each scaled to its own lane. */
  readonly aux?: readonly AuxChannel[];
  /**
   * The same channels UNFILTERED, drawn faintly beneath.
   *
   * Same order and length as `channels`. Showing both is the only way to see what a filter
   * removed rather than what it left — the filtered trace alone looks perfectly plausible,
   * which is the entire problem with filtering.
   */
  readonly raw?: readonly Float64Array[];
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

  // A RESERVED FOOTER, because the calibration bar used to be drawn at h - 18 -- inside the
  // bottom channel's lane, on top of its label and its trace.
  //
  // SIZED FROM THE BAR, not fixed. The bar is `display_cal_pulse_amp` tall in real pixels, so at
  // a coarse µV/mm it grows -- a constant footer would be overrun again by the same bug at a
  // different setting. This makes the reservation a function of what has to fit in it.
  const calPx = scalarValue('display_cal_pulse_amp') * (o.pxPerMm / o.sensitivityUvPerMm);
  const footerH = Math.max(26, Math.ceil(calPx) + 22);
  // Auxiliary lanes sit between the montage and the footer, behind a firmer rule, so they read
  // as a different KIND of signal rather than as three more electrodes.
  const aux = o.aux ?? [];
  const auxH = aux.length > 0 ? Math.min(120, 34 * aux.length) : 0;
  const plotH = cssH - footerH - auxH;
  const laneH = plotH / n;

  // --- time grid: one second per minor rule, five per major -----------------
  ctx.lineWidth = 1;
  for (let s = 0; s <= o.windowS; s++) {
    const x = left + (s / o.windowS) * plotW;
    ctx.strokeStyle = s % 5 === 0 ? ruleMajor : rule;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, plotH);
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
      ctx.fillRect(xa, 0, Math.max(1, xb - xa), plotH);
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

  // The raw overlay goes down FIRST so the filtered trace draws over it, not under it.
  if (o.raw) {
    ctx.strokeStyle = inkFaint;
    ctx.lineWidth = 1;
    for (let c = 0; c < n && c < o.raw.length; c++) {
      drawLane(ctx, o.raw[c]!, laneH * (c + 0.5), left, plotW, plotH, start, count, pxPerUv);
    }
  }

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
      ctx.moveTo(x, Math.max(0, Math.min(plotH, yTop)));
      ctx.lineTo(x, Math.max(0, Math.min(plotH, yBot)));
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

  // Boundary between EEG and everything else.
  ctx.strokeStyle = ruleMajor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(plotH) + 0.5);
  ctx.lineTo(cssW, Math.round(plotH) + 0.5);
  ctx.stroke();
  ctx.lineWidth = 1;

  drawAux(ctx, aux, left, right, plotW, plotH, auxH, start, count, inkFaint, ink, rule);

  drawCalibrationBar(ctx, left, cssH, pxPerUv, o.sensitivityUvPerMm, inkFaint, ink);
  drawEventLegend(ctx, o.events ?? [], left, cssH - footerH, cssH, inkFaint, penEvent);
}

/**
 * One lane of min/max-decimated trace. Shared by the montage and by the raw overlay, so the two
 * cannot drift into drawing the same samples differently.
 */
function drawLane(
  ctx: CanvasRenderingContext2D,
  data: Float64Array,
  mid: number,
  left: number,
  plotW: number,
  plotH: number,
  start: number,
  count: number,
  pxPerUv: number,
): void {
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
    const x = left + px + 0.5;
    ctx.moveTo(x, Math.max(0, Math.min(plotH, mid - hi * pxPerUv)));
    ctx.lineTo(x, Math.max(0, Math.min(plotH, mid - lo * pxPerUv)));
  }
  ctx.stroke();
}

/**
 * Respiration and ECG, below the montage.
 *
 * Each lane is normalised to its own peak-to-peak range and says so. See `AuxChannel` for why
 * autoscaling is correct here and wrong for the EEG above.
 */
function drawAux(
  ctx: CanvasRenderingContext2D,
  aux: readonly AuxChannel[],
  left: number,
  right: number,
  plotW: number,
  top: number,
  totalH: number,
  start: number,
  count: number,
  faint: string,
  ink: string,
  rule: string,
): void {
  if (aux.length === 0) return;
  const laneH = totalH / aux.length;

  for (let a = 0; a < aux.length; a++) {
    const y0 = top + a * laneH;
    const mid = y0 + laneH / 2;
    const ch = aux[a]!;

    // Range over the VISIBLE window only, so the lane fills its height as the signal scrolls
    // rather than being flattened by an excursion that has already left the screen.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < start + count && i < ch.data.length; i++) {
      const v = ch.data[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo) || hi <= lo) continue;
    const scale = (laneH * 0.8) / (hi - lo);

    ctx.strokeStyle = ink;
    ctx.beginPath();
    for (let px = 0; px < plotW; px++) {
      const i0 = start + Math.floor((px / plotW) * count);
      const i1 = start + Math.floor(((px + 1) / plotW) * count);
      let mn = Infinity;
      let mx = -Infinity;
      for (let i = i0; i < i1 && i < ch.data.length; i++) {
        const v = ch.data[i]!;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mn === Infinity) continue;
      const c = (lo + hi) / 2;
      const x = left + px + 0.5;
      ctx.moveTo(x, mid - (mx - c) * scale);
      ctx.lineTo(x, mid - (mn - c) * scale);
    }
    ctx.stroke();

    if (a > 0) {
      ctx.strokeStyle = rule;
      ctx.beginPath();
      ctx.moveTo(left, Math.round(y0) + 0.5);
      ctx.lineTo(right, Math.round(y0) + 0.5);
      ctx.stroke();
    }

    ctx.fillStyle = faint;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch.label, left - 8, mid);
    // Right-aligned at the far edge: at the left it sat on top of the trace's first second.
    ctx.textAlign = 'right';
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${(hi - lo).toPrecision(3)} ${ch.unit} full scale`, right - 4, y0 + 8);
  }
}

/**
 * Name the pink bands.
 *
 * They mark injected ground-truth events, and until now nothing on screen said so -- a reader
 * could only guess what the periodic highlights were. Ground truth being visible at all is the
 * artifact's whole advantage over a real recording, so leaving it unlabelled wasted the point.
 */
function drawEventLegend(
  ctx: CanvasRenderingContext2D,
  events: readonly TraceEvent[],
  left: number,
  footerTop: number,
  cssH: number,
  faint: string,
  penEvent: string,
): void {
  if (events.length === 0) return;
  const kinds = [...new Set(events.map((e) => e.type))].sort();
  // Centred in the FOOTER. Passing plotH here instead put the legend inside the respiration and
  // ECG lanes once those existed, drawn straight across the ECG trace.
  const y = (footerTop + cssH) / 2;

  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let x = left + 150;
  ctx.fillStyle = penEvent;
  ctx.globalAlpha = 0.12;
  ctx.fillRect(x, y - 6, 18, 12);
  ctx.globalAlpha = 1;
  ctx.fillStyle = faint;
  x += 24;
  ctx.fillText(`injected: ${kinds.join(', ').replace(/_/g, ' ')}`, x, y);
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
