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

/** Test DOM libraries may never be imported from src/ (SD-H-06, SEC-MS-10). */
const TEST_DOM_IMPORTS = {
  group: ['happy-dom', 'happy-dom/*', 'jsdom', 'jsdom/*'],
  message: 'Test DOM libraries are dev-only and must not be imported from src/ (SEC-MS-10).',
};

// Attribute bans for all of src/ui (SD-H-02, SEC-MS-02). Same names and
// selectors as the hud lane so the merge resolves to one definition.
const SET_ATTRIBUTE_STYLE_OR_ON = {
  selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(style|on)/i]",
  message: 'Inline style and on* attributes break the CSP (SD-H-02).',
};
const SET_ATTRIBUTE_NS_STYLE_OR_ON = {
  selector:
    "CallExpression[callee.property.name='setAttributeNS'][arguments.1.value=/^(style|on)/i]",
  message: 'Inline style and on* attributes break the CSP (SD-H-02).',
};
const SET_ATTRIBUTE_COMPUTED = {
  selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.type!='Literal']",
  message: 'Attribute names must be literals so the style/on* ban can see them (SD-H-02).',
};
const SET_ATTRIBUTE_NS_COMPUTED = {
  selector: "CallExpression[callee.property.name='setAttributeNS'][arguments.1.type!='Literal']",
  message: 'Attribute names must be literals so the style/on* ban can see them (SD-H-02).',
};
const UI_SYNTAX = [
  ENV_RESTRICTION,
  SET_ATTRIBUTE_STYLE_OR_ON,
  SET_ATTRIBUTE_NS_STYLE_OR_ON,
  SET_ATTRIBUTE_COMPUTED,
  SET_ATTRIBUTE_NS_COMPUTED,
];

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
            'src/ui/__probe__.ts',
            'src/ui/screens/__probe__.ts',
            'src/ui/components/__probe__.ts',
            'src/persistence/__probe__.ts',
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
    // All UI code: attribute bans on top of the foundation env restriction.
    files: ['src/ui/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...UI_SYNTAX] },
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
  prettier,
);
