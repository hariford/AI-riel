import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// Workspace packages ship ESM only, while the Electron main/preload bundles are CommonJS,
// so they are bundled in. Their npm dependencies stay external and are declared below.
const externals = externalizeDepsPlugin({ exclude: ['@airiel/protocol', '@airiel/agent-core', '@airiel/tools'] });

export default defineConfig({
  main: {
    plugins: [externals],
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    plugins: [externals],
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
