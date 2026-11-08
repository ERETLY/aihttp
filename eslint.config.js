'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'examples/auth-server/node_modules/**',
      'aihttp.min.js',
      'benchmark/pinned/**',
      'scratch-*',
      'coverage/**',
      '.commandcode/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: Object.assign({}, globals.node, globals.browser, { ahttp: 'readonly', define: 'readonly' })
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': 'off',
      'no-cond-assign': 'off',
      'no-useless-escape': 'off',
      'no-prototype-builtins': 'off',
      'no-constant-condition': 'off',
      'no-control-regex': 'off',
      'no-inner-declarations': 'off',
      'no-fallthrough': 'off',
      'no-async-promise-executor': 'off'
    }
  }
];
