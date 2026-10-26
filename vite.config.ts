import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative base so the build works from any folder (GitHub Pages, previews).
  base: './',
  resolve: {
    alias: {
      // Use ez-tree's source so its bark/leaf textures ship as normal files.
      'ez-tree-src': fileURLToPath(new URL('./node_modules/@dgreenheck/ez-tree/src/lib/index.js', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
  server: { host: true },
});
