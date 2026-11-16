// ESLint flat config. The ring rules give fast editor feedback; the
// import-graph test (tests/arch) is the authority on component edges.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Simulation-ring directories (BR-F-01, component-dependency rule 1). */
const SIM_RING = [
  'core',
  'contracts',
  'maps',
  'physics',
  'nav',
  'sim',
  'weapons',
  'combat',
  'ai',
].map((d) => `src/${d}/**/*.ts`);

/** HTML-injection and document.write bans for all of src/ (SEC-F-10, SEC-F-11). */
const SRC_RESTRICTED_PROPERTIES = [
  { object: 'document', property: 'write', message: 'document.write is banned (SEC-F-11).' },
  { object: 'document', property: 'writeln', message: 'document.writeln is banned (SEC-F-11).' },
  { property: 'innerHTML', message: 'Use textContent or DOM APIs, not innerHTML (SEC-F-11).' },
  { property: 'outerHTML', message: 'outerHTML is banned (SEC-F-11).' },
  { property: 'insertAdjacentHTML', message: 'insertAdjacentHTML is banned (SEC-F-11).' },
  {
    property: 'createContextualFragment',
    message: 'createContextualFragment is banned (SEC-F-11).',
  },
];

const SIM_RESTRICTED_PROPERTIES = [
  ...SRC_RESTRICTED_PROPERTIES,
  { object: 'Math', property: 'random', message: 'Use an injected Rng stream (BR-F-02).' },
];

const ENV_RESTRICTION = {
  selector:
    "MemberExpression[object.type='MemberExpression'][object.object.type='MetaProperty'][object.property.name='env']:not([property.name=/^(MODE|DEV|PROD)$/])",
  message: 'Only import.meta.env.MODE, DEV and PROD may be read in src/ (SD-F-09).',
};

const SIM_BANNED_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'performance',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'Date',
].map((name) => ({ name, message: `Simulation-ring code must not read ${name} (BR-F-01).` }));

/** Extra bans for map data: maps are compiled-in data, never loaded at runtime (SEC-M-01). */
const MAPS_BANNED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'indexedDB',
  'caches',
  'structuredClone',
  'globalThis',
  'self',
  'importScripts',
].map((name) => ({ name, message: `Map data must not use ${name} (SEC-M-01).` }));

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'cdk.out/**',
      'reports/**',
      'node_modules/**',
      '.kiro-data/**',
      '.aidlc/**',
      '.kiro/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'src/core/__probe__.ts',
            'src/app/__probe__.ts',
            'src/maps/__probe__.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-restricted-properties': ['error', ...SRC_RESTRICTED_PROPERTIES],
      'no-restricted-syntax': ['error', ENV_RESTRICTION],
    },
  },
  {
    files: SIM_RING,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*', 'node:*'],
              message: 'Simulation-ring code must stay headless (req-headless-simulation).',
            },
            {
              // Relative imports that climb into an adapter-ring directory of src/.
              regex: '^(\\.\\./)+(render|ui|app|audio|input|dev|settings|persistence)(/|$)',
              message:
                'Simulation-ring code must not import adapter-ring modules (req-headless-simulation).',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...SIM_BANNED_GLOBALS],
      'no-restricted-properties': ['error', ...SIM_RESTRICTED_PROPERTIES],
    },
  },
  {
    // Later blocks replace a rule's options, so every list from the src/** and
    // sim-ring blocks is spread in before the map-specific bans (SD-M-01).
    files: ['src/maps/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...SIM_BANNED_GLOBALS, ...MAPS_BANNED_GLOBALS],
      'no-restricted-properties': [
        'error',
        ...SIM_RESTRICTED_PROPERTIES,
        {
          object: 'JSON',
          property: 'parse',
          message: 'Maps are TypeScript data, not JSON (SEC-M-01).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        ENV_RESTRICTION,
        { selector: 'ImportExpression', message: 'No dynamic import() in src/maps (SEC-M-01).' },
      ],
    },
  },
  prettier,
);
