import { defineConfig } from 'vite';

export default defineConfig({
  // RELATIVE ASSET PATHS, so the built page works wherever it is served from: a GitHub Pages
  // project site (/<repo>/), a subdirectory of a personal site, or a local file. An absolute
  // base would 404 every asset on anything but the domain root, which is the usual way a
  // static build "works locally and breaks on deploy".
  base: './',
  // Static artifact, no backend (Build Plan section 8). Everything the page needs is bundled:
  // the registry and the projection are imported as JSON modules, not fetched, so the running
  // page makes NO network requests and needs no server-side anything.
  build: { target: 'es2022', outDir: 'dist', sourcemap: true },
  server: {
    // Honour PORT so a harness that assigns one is obeyed. Without this, vite falls back to
    // its own next-free port and the caller watches the wrong address.
    port: process.env['PORT'] ? Number(process.env['PORT']) : 5173,
    strictPort: Boolean(process.env['PORT']),
  },
});
