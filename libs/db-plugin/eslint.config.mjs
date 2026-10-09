import baseConfig from '../../eslint.config.mjs';

/**
 * The plugin contract is PURE: types and small helpers every database plugin and the API share.
 * No framework, no database client, no I/O — a plugin reaches the outside world only through the
 * `HostContext` it is handed, which is also what makes plugins testable with a fake host.
 */
export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@angular/*',
                '@nestjs/*',
                '@prisma/*',
                'prisma',
                '**/generated/prisma/**',
                'node:*',
                'fs',
                'path',
                'child_process',
              ],
              message:
                'libs/db-plugin is pure TypeScript: no framework, no Node I/O. Plugins do I/O through HostContext.',
            },
            {
              group: ['**/apps/**', '@mirrorbase/ui', '@mirrorbase/ui/*'],
              message:
                'libs/db-plugin must not depend on an app or on UI code.',
            },
          ],
        },
      ],
    },
  },
];
