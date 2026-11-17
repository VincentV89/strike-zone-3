import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    // three.js stays in the single entry chunk (ID-P-03, deployment-architecture-presentation-3d):
    // hashed assets are cached immutable, so a vendor split buys little. The limit is a size guard.
    chunkSizeWarningLimit: 900, // B9 budget: 900 KB min, 200 KB brotli (check:seams)
  },
});
