import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: 2, // 2-vCPU runtime (BR-F-43)
    execArgv: ['--expose-gc'], // allocation probe in tests/core/kernel-bench.test.ts
    // The first typed ESLint probe in each tests/arch file builds the whole TS program,
    // which takes 30+ s under v8 coverage on the 2-vCPU runtime (same value as collision-nav).
    testTimeout: 60_000,
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // gl-host.ts is the WebGL boundary, covered by the manual browser check (NFR-P-Q2).
      exclude: ['src/contracts/**', 'src/app/main.ts', 'src/render/gl-host.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        // Per-glob floors; later units add their own globs at the same floor (BR-F-44).
        'src/core/**': { lines: 80 },
        'src/maps/**': { lines: 80 }, // BR-M-92
        'src/ui/hud/**': { lines: 80 },
        'src/render/**': { lines: 80 }, // NFR-P-Q2
      },
    },
  },
});
