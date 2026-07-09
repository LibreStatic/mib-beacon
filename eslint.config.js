import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

/**
 * Dependency-direction enforcement (see docs/plans/README.md):
 *  - @omc/ui and @omc/app must NOT import Node builtins or node-net-snmp directly;
 *    they talk to the engine only through the EngineAPI type surface from @omc/core.
 *  - @omc/transport is the ONLY package allowed platform-conditional / native imports.
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
  '@omc/transport',
  '@omc/transport/node',
  '@omc/transport/react-native',
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
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { import: importPlugin },
    languageOptions: {
      parserOptions: { projectService: false },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'import/no-duplicates': 'error',
    },
  },
  {
    // The engine seam: UI/app may import ONLY types from @omc/core, never Node/native.
    files: ['packages/ui/**/*.{ts,tsx}', 'packages/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: UI_APP_FORBIDDEN.map((name) => ({
            name,
            message:
              'UI/app must not import Node builtins, native modules, node-net-snmp, or transport directly. Use the EngineAPI seam from @omc/core (types only).',
          })),
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    // Tests may be looser.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/dev/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
