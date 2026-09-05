/** Lazy continuous-record view; never concatenates clinical display buffers. */
import { buildFullBandOverview, type FullBandOptions, type FullBandOverview } from './fullband.ts';
import { drawTrace } from '../render/trace.ts';
import { drawSpectrum } from '../render/spectrum.ts';
import { scalarValue, uiDomain } from '../core/registry.ts';

export function mountFullBandPanel(
  readOptions: () => FullBandOptions,
  isCausal: () => boolean,
): { invalidate(): void } {
  const host = document.getElementById('fullband') as HTMLDetailsElement;
  const status = document.getElementById('fullband-status')!;
  const trace = document.getElementById('fullband-trace') as HTMLCanvasElement;
  const spectrum = document.getElementById('fullband-spectrum') as HTMLCanvasElement;
  let key = '';
  let record: FullBandOverview | null = null;
  let scheduled = false;

  const render = (): void => {
    scheduled = false;
    if (!host.open) return;
    // Both the comparison and anti-aliasing are zero-phase. Never present their result as
    // a causal acquisition path when the user selects causal mode.
    const unavailable = isCausal();
    trace.hidden = unavailable;
    spectrum.hidden = unavailable;
    if (unavailable) {
      status.textContent = 'Continuous comparison is unavailable in causal mode. Select zero-phase to view it.';
      return;
    }
    const options = readOptions();
    const nextKey = JSON.stringify(options);
    try {
      if (key !== nextKey || !record) {
        record = buildFullBandOverview(options);
        key = nextKey;
      }
      const index = record.labels.indexOf('Fz');
      if (index < 0) throw new Error('Full-band view requires Fz');
      drawTrace(trace, {
        channels: [record.overviewRaw[index]!, record.overviewHighPassed[index]!],
        labels: ['Fz full', 'Fz HP'],
        fs: record.overviewFs, windowS: record.durationS, tOffsetS: 0,
        sensitivityUvPerMm: scalarValue('display_sensitivity'),
        pxPerMm: scalarValue('display_px_per_mm'),
      });
      const domain = uiDomain('isf_spectrum_range');
      drawSpectrum(spectrum, {
        raw: record.raw[index]!, fs: record.fs,
        spec: record.comparisonSpec, fMin: domain.lo, fMax: domain.hi,
        showFiltered: true, estimator: 'full-record',
      });
      status.textContent = `${options.state} · seed ${options.seed} · ${options.reference} · ` +
        `${record.durationS} s continuous record · Fz · comparison HP ${record.comparisonSpec.highpassHz} Hz. ` +
        'Both traces share the same anti-alias filter and voltage scale. Cortical ISF remains provisional.';
      host.dataset['recordKey'] = key;
    } catch (error) {
      trace.hidden = true;
      spectrum.hidden = true;
      status.textContent = `Full-band view unavailable: ${error instanceof Error ? error.message : String(error)}`;
      key = '';
    }
  };
  const invalidate = (): void => {
    if (!host.open || scheduled) return;
    scheduled = true;
    status.textContent = 'Preparing continuous record…';
    requestAnimationFrame(render);
  };
  host.addEventListener('toggle', invalidate);
  window.addEventListener('resize', invalidate);
  return { invalidate };
}
