import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**'] },
  {
    files: ['src/focused/**/*.ts', 'tests/focused/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2021,
      sourceType: 'module',
    },
    plugins: { '@typescript-eslint': typescriptEslint },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      ...prettier.rules,
    },
  },
];
