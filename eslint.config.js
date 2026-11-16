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
  ...[
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
  ].map((name) => ({ name, message: `Simulation-ring code must not read ${name} (BR-F-01).` })),
  // Network and global-object bans promoted from the maps block to the whole
  // sim ring (OQ-M-NFR-1 = A, SD-CN-01).
  ...[
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'indexedDB',
    'caches',
    'globalThis',
    'self',
    'importScripts',
  ].map((name) => ({
    name,
    message: `Simulation-ring code must not read ${name} (BR-F-01, SEC-CN-01).`,
  })),
];

// Attribute selectors reused by the dom.ts block below (SD-H-02, SEC-MS-02).
const SET_ATTRIBUTE_STYLE_OR_ON = {
  selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(style|on)/i]",
  message: 'Inline style and on* attributes break the CSP (SD-H-02).',
};
const SET_ATTRIBUTE_NS_STYLE_OR_ON = {
  selector:
    "CallExpression[callee.property.name='setAttributeNS'][arguments.1.value=/^(style|on)/i]",
  message: 'Inline style and on* attributes break the CSP (SD-H-02).',
};

// menus-settings unit paths (security-design-menus-settings SD-MS-03, SD-MS-06).
const MENUS_FILES = [
  'src/ui/screens/**/*.ts',
  'src/ui/components/**/*.ts',
  'src/settings/**/*.ts',
  'src/persistence/**/*.ts',
];
const MENUS_TIMER_GLOBALS = ['setTimeout', 'setInterval', 'requestAnimationFrame'];
const MENUS_BANNED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
].map((name) => ({
  name,
  message: `menus-settings code must not use ${name} (SEC-MS-05, SEC-MS-08).`,
}));
const MENUS_TIMER_BANS = MENUS_TIMER_GLOBALS.map((name) => ({
  name,
  message: `Use scope.timeout from src/ui/components/scope.ts, not ${name} (PD-MS-03).`,
}));
const MENUS_RESTRICTED_PROPERTIES = [
  { object: 'navigator', property: 'sendBeacon', message: 'No network APIs (SEC-MS-08).' },
  {
    object: 'window',
    property: 'localStorage',
    message: 'Only app-shell reads localStorage (SD-MS-03).',
  },
  { object: 'window', property: 'sessionStorage', message: 'No sessionStorage (SD-MS-03).' },
  { object: 'window', property: 'setTimeout', message: 'Use scope.timeout (PD-MS-03).' },
  { object: 'window', property: 'setInterval', message: 'Use scope.timeout (PD-MS-03).' },
];
const JSON_PARSE_BAN = {
  object: 'JSON',
  property: 'parse',
  message: 'JSON.parse is allowed only in src/persistence (security-design-menus-settings).',
};
const IMPORT_EXPRESSION_BAN = {
  selector: 'ImportExpression',
  message: 'Dynamic import() is banned in menus-settings code (SEC-MS-08).',
};
const ADD_EVENT_LISTENER_BAN = {
  selector: "CallExpression[callee.property.name='addEventListener']",
  message: 'Register listeners through scope.on from src/ui/components/scope.ts (PD-MS-03).',
};

/** Extra bans for map data: maps are compiled-in data, never loaded at runtime (SEC-M-01). */
const MAPS_BANNED_GLOBALS = ['structuredClone'].map((name) => ({
  name,
  message: `Map data must not use ${name} (SEC-M-01).`,
}));

/**
 * audio (security-design-audio SD-AU-04). Only src/audio/context.ts reads a
 * browser global; everything else in src/audio gets the AudioContextLike it
 * is given.
 */
const AUDIO_BANNED_NAMES = [
  'window',
  'document',
  'self',
  'globalThis',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'importScripts',
  'URL',
  'Audio',
  'HTMLAudioElement',
  'MediaElementAudioSourceNode',
  'MediaStreamAudioSourceNode',
  'AudioWorkletNode',
  'OfflineAudioContext',
  'AnalyserNode',
  'ScriptProcessorNode',
  'webkitAudioContext',
  'performance',
  'Date',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'queueMicrotask',
];
const audioGlobal = (name) => ({
  name,
  message: `Audio code must not use ${name}; only src/audio/context.ts touches globals (SD-AU-04).`,
});
const AUDIO_BANNED_GLOBALS = AUDIO_BANNED_NAMES.map(audioGlobal);
const AUDIO_CONTEXT_BANNED_GLOBALS = AUDIO_BANNED_NAMES.filter((n) => n !== 'globalThis').map(
  audioGlobal,
);
const AUDIO_RESTRICTED_PROPERTIES = [
  ...SRC_RESTRICTED_PROPERTIES,
  { object: 'Math', property: 'random', message: 'Use the seeded audio Rng (BR-AU-62).' },
  ...[
    'decodeAudioData',
    'audioWorklet',
    'createAnalyser',
    'createScriptProcessor',
    'createMediaElementSource',
    'createMediaStreamSource',
    'createMediaStreamDestination',
    'copyFromChannel',
    'createObjectURL',
  ].map((property) => ({
    property,
    message: `Audio synthesises from oscillators and one noise buffer; ${property} is banned (SEC-AU-08).`,
  })),
];
const AUDIO_IMPORT_EXPRESSION_BAN = {
  selector: 'ImportExpression',
  message: 'No dynamic import() in src/audio (SD-AU-04).',
};

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
            'src/physics/__probe__.ts',
            'src/nav/__probe__.ts',
            'src/ui/__probe__.ts',
            'src/ui/hud/__probe__.ts',
            'src/render/__probe__.ts',
            'src/render/gl-host.__probe__.ts',
            'src/ui/screens/__probe__.ts',
            'src/ui/components/__probe__.ts',
            'src/persistence/__probe__.ts',
            'src/sim/player/__probe__.ts',
            'src/weapons/__probe__.ts',
            'src/combat/__probe__.ts',
            'src/audio/__probe__.ts',
            'src/ai/perception/__probe__.ts',
            'src/ai/locomotion/__probe__.ts',
            'src/ai/brain/__probe__.ts',
          ],
          // The bot-ai probes make one ring-lint process open more than the default 8
          // default-project files (BR-AI-91, SD-AI-05).
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 24,
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
    // All UI code: attribute bans on top of the foundation env restriction.
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
  {
    // menus-settings: network, storage, timer and listener bans. Spreads the
    // shared lists because flat config replaces rule options (override trap).
    files: MENUS_FILES,
    rules: {
      'no-restricted-globals': ['error', ...MENUS_BANNED_GLOBALS, ...MENUS_TIMER_BANS],
      'no-restricted-properties': [
        'error',
        ...SRC_RESTRICTED_PROPERTIES,
        ...MENUS_RESTRICTED_PROPERTIES,
        JSON_PARSE_BAN,
      ],
      'no-restricted-syntax': [
        'error',
        ...UI_SYNTAX,
        IMPORT_EXPRESSION_BAN,
        ADD_EVENT_LISTENER_BAN,
      ],
    },
  },
  {
    // Persistence is the only place stored JSON is parsed (SD-MS-02).
    files: ['src/persistence/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...SRC_RESTRICTED_PROPERTIES,
        ...MENUS_RESTRICTED_PROPERTIES,
      ],
    },
  },
  {
    // scope.ts owns every listener and timer for the unit (PD-MS-03).
    files: ['src/ui/components/scope.ts'],
    rules: {
      'no-restricted-globals': ['error', ...MENUS_BANNED_GLOBALS],
      'no-restricted-syntax': ['error', ...UI_SYNTAX, IMPORT_EXPRESSION_BAN],
    },
  },
  {
    // dom.ts is the single attribute writer; its name parameter is the typed
    // AllowedAttr union (SD-MS-07), so only the computed-name selector is lifted.
    files: ['src/ui/components/dom.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ENV_RESTRICTION,
        SET_ATTRIBUTE_STYLE_OR_ON,
        SET_ATTRIBUTE_NS_STYLE_OR_ON,
        IMPORT_EXPRESSION_BAN,
        ADD_EVENT_LISTENER_BAN,
      ],
    },
  },
  {
    // audio Block A (SD-AU-04). Spreads SRC_RESTRICTED_PROPERTIES and
    // ENV_RESTRICTION because flat config replaces rule options. Does not set
    // no-restricted-imports, so the src/** TEST_DOM_IMPORTS ban still applies.
    files: ['src/audio/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...AUDIO_BANNED_GLOBALS],
      'no-restricted-properties': ['error', ...AUDIO_RESTRICTED_PROPERTIES],
      'no-restricted-syntax': ['error', ENV_RESTRICTION, AUDIO_IMPORT_EXPRESSION_BAN],
      'no-console': 'error',
    },
  },
  {
    // audio Block B: context.ts may read globalThis.AudioContext and nothing else.
    files: ['src/audio/context.ts'],
    rules: {
      'no-restricted-globals': ['error', ...AUDIO_CONTEXT_BANNED_GLOBALS],
      'no-restricted-syntax': [
        'error',
        ENV_RESTRICTION,
        AUDIO_IMPORT_EXPRESSION_BAN,
        {
          selector: "MemberExpression[object.name='globalThis'][property.name!='AudioContext']",
          message: 'context.ts may read only globalThis.AudioContext (SD-AU-04).',
        },
      ],
    },
  },
  prettier,
);
