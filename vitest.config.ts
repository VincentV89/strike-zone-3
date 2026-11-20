import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: 2, // 2-vCPU runtime (BR-F-43)
    execArgv: ['--expose-gc'], // allocation probes in tests/core and tests/bench
    // The first typed ESLint probe per lint test file builds the whole TS program; under v8
    // coverage on 2 vCPU that takes ~32 s once src/physics and src/nav exist.
    testTimeout: 60_000,
    // The json reporter feeds `npm run report` (TS-VE-03); verify itself is unchanged.
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/vitest-results.json' },
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
    coverage: {
      provider: 'v8',
      // scripts/verification is the honesty logic of the final report (TS-VE-14); the
      // entry points scripts/smoke.ts and scripts/report.ts stay thin and uncounted.
      include: ['src/**/*.ts', 'scripts/verification/**/*.ts'],
      // gl-host.ts is the WebGL boundary, covered by the manual browser check (NFR-P-Q2).
      // main.ts and pointer-lock.ts are the browser boundary of app-shell (manual-pending checks).
      exclude: [
        'src/contracts/**',
        'src/app/main.ts',
        'src/app/pointer-lock.ts',
        'src/render/gl-host.ts',
        // The asset kit's browser half (KTX2 worker, PMREM, WebGLRenderer); covered by e2e,
        // and its pure parts (glb-check, runtime, character, dressing) by Node tests.
        'src/render/assets/kit.ts',
        '**/*.d.ts',
      ],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        // Per-glob floors; later units add their own globs at the same floor (BR-F-44).
        'src/core/**': { lines: 80 },
        'src/maps/**': { lines: 80 }, // BR-M-92
        'src/ui/hud/**': { lines: 80 },
        'src/render/**': { lines: 80 }, // NFR-P-Q2
        'src/render/assets/**': { lines: 80 }, // graphics uplift
        'src/physics/**': { lines: 80 }, // BR-CN-97
        'src/nav/**': { lines: 80 }, // BR-CN-97
        'src/settings/**': { lines: 80 },
        'src/persistence/**': { lines: 80 },
        'src/ui/screens/**': { lines: 80 },
        'src/ui/components/**': { lines: 80 },
        'src/sim/player/**': { lines: 80 }, // TS-PC-09
        'src/sim/**': { lines: 80 }, // BR-GS-93, TS-GS-08
        'src/weapons/**': { lines: 80 }, // TS-PC-09
        'src/combat/**': { lines: 80 }, // TS-PC-09
        'src/audio/**': { lines: 80 }, // BR-AU-92
        'src/ai/**': { lines: 80 }, // BR-AI-91
        'src/app/**': { lines: 80 }, // app-shell (business-logic-model-app-shell §15)
        'src/input/**': { lines: 80 },
        'src/dev/**': { lines: 80 },
        'scripts/verification/**': { lines: 80 }, // TS-VE-14
      },
    },
  },
});
