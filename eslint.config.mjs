import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      '**/drizzle/meta/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      // Functional style everywhere except NestJS (see override below).
      'no-restricted-syntax': [
        'error',
        { selector: 'ClassDeclaration', message: 'Classes are allowed only in apps/api (NestJS).' },
        { selector: 'ClassExpression', message: 'Classes are allowed only in apps/api (NestJS).' },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
