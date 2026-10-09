import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    // Build output, and the legacy PowerShell script's backup folders.
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vitest.config.*.timestamp*',
      '**/.pnpm-store',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      // A leading underscore is this repo's existing, consistent way of saying "this parameter is
      // part of a signature I do not control and I am deliberately not using it". It was already
      // written that way in a dozen places — `_query`, `_command` in CQRS handlers, whose
      // `execute(query)` signature is fixed by `@nestjs/cqrs` even when the handler needs nothing
      // from the message — but nothing told eslint, so each one still counted as tracked debt.
      //
      // Warning on them made the signal worse, not better: a warning you are supposed to ignore
      // teaches you to ignore warnings. Genuinely dead variables still warn, and those were
      // deleted rather than renamed.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // In a spec, `array[0]!` that is not there fails the test with a stack trace pointing at the
    // line - which is exactly what a `?? fail()` would do, with more noise. Production code keeps
    // the rule: there a wrong `!` is a crash for the person using the app.
    files: ['**/*.spec.ts', '**/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
