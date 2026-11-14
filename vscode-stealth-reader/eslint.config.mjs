import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'scripts/**', '*.js', '*.mjs'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      eqeqeq: 'error',
      curly: ['error', 'multi-line'],
    },
  },
);
