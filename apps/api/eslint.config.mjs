import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // Generated Prisma Client: machine output, overwritten by `prisma generate`.
    ignores: ['src/generated/**'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      // Only src/persistence may hold a database client; features depend on a repository port.
      '@nx/workspace-no-direct-prisma-access': 'error',
      // Nest resolves constructor parameters by type, so the decorator metadata is the point of
      // these declarations even when nothing in the body references them.
      '@typescript-eslint/no-useless-constructor': 'off',
    },
  },
  {
    // The same fence for the database plugins' CLIs and the docker CLI: only src/integrations
    // (the docker adapter) and src/plugins (the process runner) may spawn processes; everything
    // else depends on a port or on the HostContext it is handed.
    files: ['**/*.ts'],
    ignores: ['src/integrations/**', 'src/plugins/**', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:child_process', 'child_process'],
              message:
                'Processes are spawned in src/integrations (docker) and src/plugins (the host runner) only. Depend on a port instead (see CLAUDE.md, "Persistence architecture").',
            },
          ],
        },
      ],
    },
  },
];
