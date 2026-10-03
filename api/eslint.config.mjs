import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ['dist/'] },
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
