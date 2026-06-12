// Flat config (ESLint 9+). Two environments live in this repo:
//   1. Node — main.js, server-module.js, lib/, tests/
//   2. Browser — public/index.html (inline scripts) and public/visualizer.js
// We split rules so the Node side gets node globals and the browser side
// gets DOM globals, instead of a single permissive config.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Ignore generated/external files entirely.
  // public/js/** is the legacy renderer monolith split into modules — it
  // predates this lint config and uses a lot of `var` / cross-file globals
  // that ESLint can't reason about without a build step. We lint the Node
  // side strictly and leave the renderer untouched until it's modularised.
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'public/js/**',
      'public/visualizer.js',
      'public/sw.js',
      'dev-data/**',
    ],
  },

  // Base recommended rules apply to everything.
  js.configs.recommended,

  // Node-side files.
  {
    files: ['main.js', 'preload.js', 'server-module.js', 'lib/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
      'no-var': 'warn',
      'prefer-const': 'warn',
    },
  },

  // Browser-side files.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
