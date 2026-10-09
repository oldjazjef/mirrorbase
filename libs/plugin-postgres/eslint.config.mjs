import baseConfig from '../../eslint.config.mjs';

/**
 * A database plugin implements `DatabasePlugin` from @mirrorbase/db-plugin and nothing else of
 * this workspace: no Nest, no Prisma, no Angular, no app code. The API discovers plugins; plugins
 * never reach into the API.
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
                '**/apps/**',
                '@mirrorbase/ui',
                '@mirrorbase/ui/*',
              ],
              message:
                'A plugin depends on @mirrorbase/db-plugin only — talk to the outside world through HostContext.',
            },
          ],
        },
      ],
    },
  },
];
