'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', '.vercel/**'],
  },
  js.configs.recommended,
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        module: 'readonly',
      },
    },
  },
  {
    files: ['*.js', 'api/**/*.js', 'lib/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Blob: 'readonly',
        DOMException: 'readonly',
        fetch: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        Response: 'readonly',
      },
    },
  },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },
];
