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

/** DOM test libraries never ship (SD-H-06). */
const TEST_DOM_IMPORTS = {
  group: ['happy-dom', 'happy-dom/*', 'jsdom', 'jsdom/*'],
  message: 'DOM test libraries are for tests only (SD-H-06).',
};

/** Styling and handler attributes in src/ui (SD-H-02). Use CSSOM or classList. */
const UI_SYNTAX = [
  ENV_RESTRICTION,
  {
    selector:
      "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(style|on)/i]",
    message: 'Use CSSOM or classList, not style or on* attributes (SD-H-02).',
  },
  {
    selector:
      "CallExpression[callee.property.name='setAttributeNS'][arguments.1.value=/^(style|on)/i]",
    message: 'Use CSSOM or classList, not style or on* attributes (SD-H-02).',
  },
  {
    selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.type!='Literal']",
    message: 'Attribute names must be string literals (SD-H-02).',
  },
  {
    selector: "CallExpression[callee.property.name='setAttributeNS'][arguments.1.type!='Literal']",
    message: 'Attribute names must be string literals (SD-H-02).',
  },
];

/** Extra syntax bans for the HUD (SD-H-02): no URL attributes, no style text. */
const HUD_SYNTAX = [
  ...UI_SYNTAX,
  {
    selector:
      "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^((xlink:)?href|src)$/]",
    message: 'The HUD sets no URL-bearing attributes (SD-H-02).',
  },
  {
    selector:
      "CallExpression[callee.property.name='setAttributeNS'][arguments.1.value=/^((xlink:)?href|src)$/]",
    message: 'The HUD sets no URL-bearing attributes (SD-H-02).',
  },
  {
    selector: "AssignmentExpression[left.property.name='cssText']",
    message: 'cssText bypasses the node cache and is a style-text sink (SD-H-02).',
  },
];

/** Capabilities the HUD has no reason to use (SD-H-03). */
const HUD_BANNED_NAMES = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'requestIdleCallback',
  'queueMicrotask',
  'open',
  'postMessage',
  'getComputedStyle',
];
const HUD_BANNED_GLOBALS = HUD_BANNED_NAMES.map((name) => ({
  name,
  message: `The HUD must not use ${name} (SD-H-03).`,
}));
const HUD_RESTRICTED_PROPERTIES = [
  ...HUD_BANNED_NAMES.map((property) => ({
    object: 'window',
    property,
    message: `The HUD must not use window.${property} (SD-H-03).`,
  })),
  { object: 'navigator', property: 'sendBeacon', message: 'The HUD sends nothing (SD-H-03).' },
  ...[
    'addEventListener',
    'offsetWidth',
    'offsetHeight',
    'clientWidth',
    'clientHeight',
    'getBoundingClientRect',
  ].map((property) => ({
    property,
    message: `The HUD registers no listeners and reads no layout: ${property} (SD-H-03).`,
  })),
];

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

/** Renderer bans (security-design-presentation-3d SEC-P-01/02/07/11). */
const RENDER_BANNED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'Date',
  'importScripts',
  'window',
].map((name) => ({ name, message: `${name} is banned in src/render (SEC-P-01/02/07/11).` }));

const RENDER_PROPERTIES = [
  ...SRC_RESTRICTED_PROPERTIES,
  { object: 'Math', property: 'random', message: 'Use hash32 or a seeded Rng (SEC-P-07).' },
  { object: 'performance', property: 'now', message: 'Visuals run on render time (SEC-P-07).' },
  { object: 'document', property: 'cookie', message: 'No storage in src/render (SEC-P-02).' },
];

/** Shared by both render blocks; UI_SYNTAX already carries ENV_RESTRICTION. */
const RENDER_SYNTAX_BASE = [
  ...UI_SYNTAX,
  { selector: 'ImportExpression', message: 'No dynamic import() in src/render (SEC-P-01).' },
  {
    selector: 'ImportSpecifier[imported.name=/Loader$/]',
    message: 'No three.js loaders: textures are procedural DataTextures (SEC-P-01).',
  },
];

/** Lifted only for gl-host.ts (SEC-P-04). */
const RENDER_HOST_ONLY = [
  {
    selector: 'CallExpression[callee.property.name=/^(add|remove)EventListener$/]',
    message: 'Only gl-host.ts touches the canvas (SEC-P-04).',
  },
  {
    selector: "ImportSpecifier[imported.name='WebGLRenderer']",
    message: 'Only gl-host.ts constructs WebGLRenderer (SEC-P-04).',
  },
];

const RENDER_IMPORTS = {
  patterns: [
    TEST_DOM_IMPORTS,
    {
      group: ['three/addons/*', 'three/examples/*', 'three/webgpu', 'three/tsl'],
      message: 'Named imports from three only (TS-P-01, TS-P-08).',
    },
  ],
};

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
            'src/ui/__probe__.ts',
            'src/ui/hud/__probe__.ts',
            'src/render/__probe__.ts',
            'src/render/gl-host.__probe__.ts',
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
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'infra/**/*.ts', '*.config.ts'],
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
      'no-restricted-imports': ['error', { patterns: [TEST_DOM_IMPORTS] }],
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
            TEST_DOM_IMPORTS,
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
  {
    // Flat config replaces rule options instead of merging them, so every
    // narrower block spreads the src/** lists it would otherwise drop.
    files: ['src/ui/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...UI_SYNTAX] },
  },
  {
    files: ['src/ui/hud/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...HUD_SYNTAX],
      'no-restricted-globals': ['error', ...HUD_BANNED_GLOBALS],
      'no-restricted-properties': [
        'error',
        ...SRC_RESTRICTED_PROPERTIES,
        ...HUD_RESTRICTED_PROPERTIES,
      ],
    },
  },
  {
    // Block A: every list the src/** block sets is re-included (override trap, SEC-P-09).
    files: ['src/render/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...RENDER_BANNED_GLOBALS],
      'no-restricted-properties': ['error', ...RENDER_PROPERTIES],
      'no-restricted-syntax': ['error', ...RENDER_SYNTAX_BASE, ...RENDER_HOST_ONLY],
      'no-restricted-imports': ['error', RENDER_IMPORTS],
    },
  },
  {
    // Block B: gl-host.ts may listen on the canvas and construct WebGLRenderer.
    files: ['src/render/gl-host*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...RENDER_SYNTAX_BASE] },
  },
  prettier,
);
