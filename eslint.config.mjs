import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    // This pass checks TypeScript only, not existing JS or vendored assets.
    ignores: [
      '**/*.{js,mjs,cjs}',
      'node_modules/**',
      'dist/**',
      'artifacts/**',
      '.publication-*/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['{src,tests,e2e,config,scripts}/**/*.{ts,tsx,mts}', '*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    // Explicit quality rules; Prettier owns layout and tsc owns type correctness.
    rules: {
      'constructor-super': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-var': 'error',
      'one-var': ['error', 'never'],
      'prefer-const': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // Browser fixtures' `use` callbacks are Playwright, not React Hooks.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
