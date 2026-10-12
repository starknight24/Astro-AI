import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ['dist/'] },
  {
    // Plain-JS tooling (scripts/local-auth.mjs) runs on Node directly rather
    // than through tsx, so it is not covered by the TypeScript config that
    // supplies these globals. Without this, `process` and `console` are
    // reported as undefined in a file that is correct.
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    rules: {
      // The codebase already marks intentionally-unused parameters with a
      // leading underscore (`_req`, `_res`). The default `args: 'after-used'`
      // accepts that only when a used parameter follows, which breaks for
      // Express error handlers: those are identified by their four-argument
      // signature, so `next` must be declared even though it is never called.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
