/**
 * The artifact.
 *
 * "THE TIER 0 SHIPPING TEST: if everything except the scrolling trace and the filter
 * demonstration were deleted on the last day, the artifact would still make its point. Build
 * in that order. The filter demonstration — injected coupling, a user-movable cutoff, and the
 * ground-truth line visibly diverging from the recovered estimate — is the thesis. Protect it
 * above everything else."
 */
import '../tokens/tokens.css';
import { composeState } from '../core/generators/compose.ts';
import { ALL_CHANNELS } from '../core/generators/projection.ts';
import { STATE_IDS, STATE_LABELS, type StateId } from '../core/types/state.ts';
import { applyHighpass, ringingDemo, type FilterType } from '../core/filters/hpf.ts';
import { couplingReadout } from '../analysis/coupling.ts';
import { broadbandExponent, narrowbandExponent } from '../analysis/psd.ts';
import { lempelZiv } from '../analysis/lz.ts';
import { formatExponent } from '../core/types/exponent.ts';
import { Rng } from '../core/rng/xoshiro128pp.ts';
import { drawTrace } from '../render/trace.ts';
import {
  scalarValue,
  enumValue,
  inventedKeys,
  record,
  GENERATOR_VERSION,
} from '../core/registry.ts';

const FS = scalarValue('fs');
const WINDOW_S = scalarValue('epoch_display');
const N = Math.round(FS * WINDOW_S);

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

interface UiState {
  state: StateId;
  seed: number;
  hpf: number;
  ftype: FilterType;
}

const ui: UiState = {
  state: 'n3',
  seed: scalarValue('snr_calibration_seed'),
  hpf: enumValue('hpf_options')[0] as number,
  ftype: 'zeroPhase',
};

/** Cached so filter changes do not regenerate the signal — only re-filter it. */
let generated: ReturnType<typeof composeState> | null = null;

function regenerate(): void {
  generated = composeState(ui.seed, ui.state, N, FS, { chiModulation: true });
}

function render(): void {
  if (!generated) regenerate();
  const g = generated!;

  // Filter every channel at the chosen cutoff. This is the demonstration: the same signal,
  // seen through the filter a real recording would have applied.
  const filtered = g.channels.map((c) => applyHighpass(c, ui.hpf, ui.ftype, FS));

  drawTrace($<HTMLCanvasElement>('trace'), {
    channels: filtered,
    labels: ALL_CHANNELS,
    fs: FS,
    sensitivityUvPerMm: scalarValue('display_sensitivity'),
    pxPerMm: scalarValue('display_px_per_mm'),
    events: g.events.map((e) => ({ onset: e.onset, duration: e.duration, type: e.type })),
    windowS: WINDOW_S,
    tOffsetS: 0,
  });

  $('trace-note').textContent =
    `${ALL_CHANNELS.length} channels (19 scalp + 2 mastoid), ${WINDOW_S} s, ` +
    `negative up, fixed ${scalarValue('display_sensitivity')} µV/mm — never autoscaled. ` +
    `Shaded bands are injected events from the ground-truth list. ` +
    `Generator v${GENERATOR_VERSION}.`;

  // --- Demo 1: coupling loss ------------------------------------------------
  const cz = filtered[ALL_CHANNELS.indexOf('Cz')]!;
  const c = couplingReadout(cz, g.truth.chiModDepth, g.truth.respFreqHz, FS);
  $('c-inj').textContent = c.injectedDepth.toFixed(4);
  $('c-rec').textContent = Number.isFinite(c.recoveredDepth) ? c.recoveredDepth.toFixed(4) : '—';
  $('c-ret').textContent = Number.isFinite(c.retained)
    ? `${(100 * c.retained).toFixed(0)}%`
    : '—';

  // --- Observables ----------------------------------------------------------
  const pz = filtered[ALL_CHANNELS.indexOf('Pz')]!;
  $('o-broad').textContent = formatExponent(broadbandExponent(pz, FS));
  $('o-narrow').textContent = formatExponent(narrowbandExponent(pz, FS));
  const subset = ['Fz', 'Cz', 'Pz', 'O1'].map((l) => filtered[ALL_CHANNELS.indexOf(l)]!);
  const lz = lempelZiv(subset, Rng.substream(ui.seed, 'lz-ui'), 'lzw');
  $('o-lz').textContent = lz.normalized.toFixed(4);
  // A normalized complexity is meaningless without naming its null. D1 requires this here.
  $('lz-null').textContent = `Normalized against: ${lz.nullDescription}. Parse: ${lz.parse}.`;

  renderDemo3(g);
}

/**
 * Demo 3 — ringing on an isolated graphoelement.
 *
 * The most visceral of the three, because it is visible in the trace: with ground truth you
 * can label exactly which deflections the filter invented.
 */
function renderDemo3(g: NonNullable<typeof generated>): void {
  const canvas = $<HTMLCanvasElement>('demo3');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  ctx.fillStyle = css('--paper');
  ctx.fillRect(0, 0, w, h);

  // Find an isolated K-complex, or fall back to the middle of the buffer.
  const kc = g.events.find((e) => e.type === 'kcomplex');
  const centre = kc ? kc.onset + kc.duration / 2 : WINDOW_S / 2;
  const spanS = 3;
  const a = Math.max(0, Math.round((centre - spanS / 2) * FS));
  const b = Math.min(N, a + Math.round(spanS * FS));

  const fz = g.channels[ALL_CHANNELS.indexOf('Fz')]!.slice(a, b);
  const { filtered, invented } = ringingDemo(fz, ui.hpf, ui.ftype, FS);

  const pxPerUv = scalarValue('display_px_per_mm') / scalarValue('display_sensitivity');
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
  draw(filtered, css('--pen-trace'), 1);
  draw(invented, css('--pen-event'), 1.2);

  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = css('--ink-faint');
  ctx.fillText('unfiltered', 8, 14);
  ctx.fillStyle = css('--pen-trace');
  ctx.fillText(`high-passed at ${ui.hpf} Hz (${ui.ftype})`, 8, 26);
  ctx.fillStyle = css('--pen-event');
  ctx.fillText('invented by the filter', 8, 38);
}

/**
 * Every `invented` parameter, listed and marked.
 *
 * Risk register, rated High: "Constants ship `invented` and the UI fails to mark them." The
 * list is generated FROM the registry, so a new invented row cannot ship unmarked — nobody has
 * to remember to add it here.
 */
function renderInvented(): void {
  const keys = inventedKeys();
  const host = $('invented-list');
  host.innerHTML = '';

  const summary = document.createElement('p');
  summary.className = 'note';
  summary.textContent =
    `${keys.length} of the registry's parameters are not empirically constrained. ` +
    `They are listed because a hidden literal would be worse.`;
  host.appendChild(summary);

  const box = document.createElement('div');
  box.className = 'invented';
  box.style.maxHeight = '180px';
  box.style.overflowY = 'auto';
  box.style.fontFamily = 'var(--font-mono)';
  box.style.fontSize = 'var(--size-xs)';
  box.textContent = keys.join('  ·  ');
  host.appendChild(box);

  const derived = document.createElement('p');
  derived.className = 'note';
  const snr = record('snr_nominal');
  derived.textContent = `snr_nominal is ${snr.standing}: solved once on a fixture seed, held out of every G5 evaluation.`;
  host.appendChild(derived);
}

function mount(): void {
  const stateSel = $<HTMLSelectElement>('state');
  for (const s of STATE_IDS) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = STATE_LABELS[s];
    if (s === ui.state) o.selected = true;
    stateSel.appendChild(o);
  }
  stateSel.addEventListener('change', () => {
    ui.state = stateSel.value as StateId;
    regenerate();
    render();
  });

  const seedInput = $<HTMLInputElement>('seed');
  seedInput.value = String(ui.seed);
  seedInput.addEventListener('change', () => {
    const v = Number(seedInput.value);
    if (Number.isInteger(v)) {
      ui.seed = v;
      regenerate();
      render();
    }
  });

  const hpfSel = $<HTMLSelectElement>('hpf');
  for (const v of enumValue('hpf_options')) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = String(v);
    hpfSel.appendChild(o);
  }
  hpfSel.value = String(ui.hpf);
  hpfSel.addEventListener('change', () => {
    ui.hpf = Number(hpfSel.value);
    render(); // no regeneration: the same signal, a different filter
  });

  for (const btn of Array.from($('ftype').querySelectorAll('button'))) {
    btn.addEventListener('click', () => {
      ui.ftype = (btn as HTMLElement).dataset['v'] as FilterType;
      for (const b of Array.from($('ftype').querySelectorAll('button'))) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      render();
    });
  }

  renderInvented();
  regenerate();
  render();
  window.addEventListener('resize', render);
}

mount();
