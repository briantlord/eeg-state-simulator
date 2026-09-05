/** Common inputs for independent Python/SciPy parity checks, including the saved calibration. */
import { aasmFiltered, aasmN3, AASM_SCORER_VERSION } from '../../src/analysis/aasm.ts';
import { composeState, type ComposeOptions } from '../../src/core/generators/compose.ts';
import { ALL_CHANNELS } from '../../src/core/generators/projection.ts';
import { RELEASE_CALIBRATION } from '../../src/core/release.ts';
const fs = 256;
const n = fs * 30;
const samples: { name: string; raw: Float64Array }[] = [
  { name: 'silence', raw: new Float64Array(n) },
  ...[20, 40, 80].map((amplitude) => ({ name: `sine-${amplitude}`,
    raw: Float64Array.from({ length: n }, (_, i) => amplitude * Math.sin(2 * Math.PI * i / fs)) })),
  { name: 'offset-and-edges', raw: Float64Array.from({ length: n }, (_, i) =>
    100 + 60 * Math.sin(2 * Math.PI * 0.75 * i / fs) + (i < 40 || i > n - 20 ? 150 : 0)) },
];
const cal = RELEASE_CALIBRATION;
const generated = composeState(cal.fixture.seed, 'n3', n, fs, { ...(cal.options as ComposeOptions), snrDb: cal.value_db });
const c3 = generated.channels[ALL_CHANNELS.indexOf('C3')]!;
const a2 = generated.channels[ALL_CHANNELS.indexOf('A2')]!;
samples.push({ name: 'calibration', raw: Float64Array.from(c3, (value, i) => value - a2[i]!) });
console.log(JSON.stringify({ version: AASM_SCORER_VERSION, fs, cases: samples.map(({ name, raw }) => ({
  name, raw: [...raw], filtered: [...aasmFiltered(raw, fs)],
  fraction: aasmN3([raw, new Float64Array(n)], ['C3', 'A2'], fs).fraction,
})) }));
