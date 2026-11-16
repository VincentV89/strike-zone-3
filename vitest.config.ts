import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: 2, // 2-vCPU runtime (BR-F-43)
    execArgv: ['--expose-gc'], // allocation probe in tests/core/kernel-bench.test.ts
    testTimeout: 30_000,
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/contracts/**', 'src/app/main.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        // Per-glob floors; later units add their own globs at the same floor (BR-F-44).
        'src/core/**': { lines: 80 },
        'src/maps/**': { lines: 80 }, // BR-M-92
        'src/ui/hud/**': { lines: 80 },
        'src/settings/**': { lines: 80 },
        'src/persistence/**': { lines: 80 },
        'src/ui/screens/**': { lines: 80 },
        'src/ui/components/**': { lines: 80 },
      },
    },
  },
});
