import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Dependency-direction enforcement (see docs/plans/README.md):
 *  - @mibbeacon/ui and @mibbeacon/app must NOT import Node builtins or node-net-snmp directly;
 *    they talk to the engine only through the EngineAPI type surface from @mibbeacon/core.
 *  - @mibbeacon/transport is the ONLY package allowed platform-conditional / native imports.
 */
const NODE_BUILTINS = [
  'fs',
  'node:fs',
  'dgram',
  'node:dgram',
  'net',
  'node:net',
  'crypto',
  'node:crypto',
  'tls',
  'node:tls',
  'node:sqlite',
  'electron',
];

const UI_APP_FORBIDDEN = [
  ...NODE_BUILTINS,
  'net-snmp',
  '@mibbeacon/transport',
  '@mibbeacon/transport/node',
  '@mibbeacon/transport/react-native',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/metro.config.*',
      '**/babel.config.*',
      '**/*.generated.ts',
      'docs/**/scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS files that run in the Node/RN CommonJS or bundler-entry context.
    files: ['**/*.cjs', '**/*.mjs', '**/shims/**/*.js', 'apps/*/index.js'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
        global: 'readonly',
        console: 'readonly',
        exports: 'writable',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { import: importPlugin },
    languageOptions: {
      parserOptions: { projectService: false },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Ambient module decls (e.g. net-snmp) are pulled in via path references so
      // that consumers of the compiled source pick them up.
      '@typescript-eslint/triple-slash-reference': ['error', { path: 'always', types: 'prefer-import' }],
      'import/no-duplicates': 'error',
    },
  },
  {
    // The engine seam: UI/app may import ONLY types from @mibbeacon/core, never Node/native.
    files: ['packages/ui/**/*.{ts,tsx}', 'packages/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: UI_APP_FORBIDDEN.map((name) => ({
            name,
            message:
              'UI/app must not import Node builtins, native modules, node-net-snmp, or transport directly. Use the EngineAPI seam from @mibbeacon/core (types only).',
          })),
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    // App screens/components must import `Text` from @mibbeacon/ui (which applies
    // the theme color + dynamic-type cap), never the raw react-native primitive.
    // Redeclares no-restricted-imports so it must re-list the shared forbidden set.
    files: ['packages/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...UI_APP_FORBIDDEN.map((name) => ({
              name,
              message:
                'UI/app must not import Node builtins, native modules, node-net-snmp, or transport directly. Use the EngineAPI seam from @mibbeacon/core (types only).',
            })),
            {
              name: 'react-native',
              importNames: ['Text'],
              message:
                'Import Text from @mibbeacon/ui so it applies the theme color and the dynamic-type cap (maxFontSizeMultiplier).',
            },
          ],
        },
      ],
    },
  },
  {
    // React components (UI + app).
    files: ['packages/ui/**/*.tsx', 'packages/app/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Tests may be looser. They run in Node, so the engine-seam import ban
    // (which forbids node:fs etc.) does not apply — source-scan guards read files.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/dev/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
