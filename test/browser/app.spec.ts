import { test, expect, type Page } from '@playwright/test';

const spectrum = (page: Page) => page.locator('#spectrum').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#version')).toContainText('physiology-v1');
  await expect.poll(() => page.evaluate(() =>
    (globalThis as unknown as { __eegsim: { elapsed(): number } }).__eegsim.elapsed())).toBeGreaterThan(0);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('play');
});

test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test('visible spectrum follows state, seed, reference, filter and segment changes with archived panels absent', async ({ page }) => {
  await expect(page.locator('#c-chi')).toHaveCount(0);
  await expect(page.locator('#ref-note')).not.toBeEmpty();
  let before = await spectrum(page);
  await page.locator('#state').selectOption('n3');
  await expect.poll(() => spectrum(page)).not.toBe(before);
  before = await spectrum(page);
  await page.locator('#seed').fill('20260904');
  await page.locator('#seed').blur();
  await expect.poll(() => spectrum(page)).not.toBe(before);
  before = await spectrum(page);
  await page.locator('#reference').selectOption('average');
  await expect.poll(() => spectrum(page)).not.toBe(before);
  before = await spectrum(page);
  await page.locator('#forder').selectOption('2');
  await expect.poll(() => spectrum(page)).not.toBe(before);
  before = await spectrum(page);
  await page.locator('#ftype button[data-v="causal"]').click();
  await expect.poll(() => spectrum(page)).not.toBe(before);
  before = await spectrum(page);
  await page.evaluate(() => {
    const api = (globalThis as unknown as { __eegsim: { step(dt: number): void } }).__eegsim;
    api.step(95);
  });
  await expect.poll(() => spectrum(page)).not.toBe(before);
  await page.screenshot({ path: 'prep/out/browser-stabilized.png', fullPage: true });
});

test('continuous overview exposes duration and mechanism controls and fails closed in causal mode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#fullband summary').click();
  await expect(page.locator('#fullband-status')).toContainText('120 s continuous record');
  await expect(page.locator('#fullband-trace')).toBeVisible();
  await page.locator('#fullband-duration').selectOption('300');
  await expect(page.locator('#fullband-status')).toContainText('300 s continuous record');
  await page.locator('#isf-cortical').uncheck();
  await expect(page.locator('#fullband')).toHaveAttribute('data-record-key', /"infraSlowCortical":false/);
  await page.locator('#state').selectOption('n2');
  await expect(page.locator('#fullband-status')).toContainText('n2 ·');
  await page.locator('#ftype button[data-v="causal"]').click();
  await expect(page.locator('#fullband-status')).toContainText('unavailable in causal mode');
  await expect(page.locator('#fullband-trace')).toBeHidden();
  await expect(page.locator('#fullband-spectrum')).toBeHidden();
  await page.locator('#ftype button[data-v="zeroPhase"]').click();
  await expect(page.locator('#fullband-status')).toContainText('300 s continuous record');
  await expect(page.locator('#fullband-trace')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'prep/out/browser-fullband.png', fullPage: true });
});

test('EEG and raw overlay draw negative voltage up while auxiliary positive voltage draws up', async ({ page }) => {
  const paths = await page.evaluate(async () => {
    // Exercise the actual renderer; capture its canvas paths rather than testing a duplicate sign formula.
    const rendererUrl = '/src/render/trace.ts';
    const { drawTrace } = await import(rendererUrl);
    const paths: number[][][] = [];
    let path: number[][] = [];
    const noop = () => {};
    const ctx = new Proxy({
      beginPath: () => { path = []; },
      moveTo: (x: number, y: number) => path.push([x, y]),
      lineTo: (x: number, y: number) => path.push([x, y]),
      stroke: () => paths.push(path),
      measureText: () => ({ width: 0 }),
    }, { get: (target, prop) => Reflect.get(target, prop) ?? noop });
    const canvas = { clientWidth: 800, clientHeight: 400, width: 800, height: 400,
      getContext: () => ctx } as unknown as HTMLCanvasElement;
    const pulse = new Float64Array([0, -10, 0, 10, 0]);
    drawTrace(canvas, { channels: [pulse], raw: [pulse], labels: ['test'], fs: 5,
      windowS: 1, tOffsetS: 0, sensitivityUvPerMm: 1, pxPerMm: 1,
      aux: [{ label: 'ECG', data: pulse, unit: 'uV' }] });
    return paths.filter((path) => path.length === 5);
  });
  expect(paths).toHaveLength(3);
  for (const path of paths.slice(0, 2)) {
    expect(path[1]![1]!).toBeLessThan(path[0]![1]!);
    expect(path[3]![1]!).toBeGreaterThan(path[0]![1]!);
  }
  expect(paths[2]![1]![1]!).toBeGreaterThan(paths[2]![0]![1]!);
  expect(paths[2]![3]![1]!).toBeLessThan(paths[2]![0]![1]!);
});
