import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    // three.js alone is about 530 kB minified; code splitting is a later presentation-3d concern.
    chunkSizeWarningLimit: 800,
  },
});
