import { defineConfig } from 'vite';

export default defineConfig({
  // Static artifact, no backend (Build Plan section 8).
  build: { target: 'es2022', outDir: 'dist', sourcemap: true },
  server: {
    // Honour PORT so a harness that assigns one is obeyed. Without this, vite falls back to
    // its own next-free port and the caller watches the wrong address.
    port: process.env['PORT'] ? Number(process.env['PORT']) : 5173,
    strictPort: Boolean(process.env['PORT']),
  },
});
