import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: 2, // 2-vCPU runtime (BR-F-43)
    execArgv: ['--expose-gc'], // allocation probes in tests/core and tests/bench
    // The first typed ESLint probe in tests/arch builds the whole TS program; under v8
    // coverage on 2 vCPU that takes ~32 s once src/physics and src/nav exist.
    testTimeout: 60_000,
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
        'src/physics/**': { lines: 80 }, // BR-CN-97
        'src/nav/**': { lines: 80 }, // BR-CN-97
        'src/settings/**': { lines: 80 },
        'src/persistence/**': { lines: 80 },
        'src/ui/screens/**': { lines: 80 },
        'src/ui/components/**': { lines: 80 },
      },
    },
  },
});
