import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

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
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
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
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  ...['pages', 'widgets', 'features', 'entities', 'shared'].map((layer) => ({
    files: [`apps/web/src/${layer}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['app', 'pages', 'widgets', 'features', 'entities', 'shared']
            .slice(
              0,
              ['app', 'pages', 'widgets', 'features', 'entities', 'shared'].indexOf(layer) + 1,
            )
            .filter((l) => l !== layer)
            .map((l) => ({
              group: [`@/${l}`, `@/${l}/*`],
              message: `FSD: layer "${layer}" must not import from the higher layer "${l}".`,
            })),
        },
      ],
    },
  })),
);
