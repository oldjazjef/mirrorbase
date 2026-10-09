import { Global, Module } from '@nestjs/common';
import { postgresPlugin } from '@mirrorbase/plugin-postgres';
import { sqlitePlugin } from '@mirrorbase/plugin-sqlite';
import { PluginHostFactory } from './plugin-host';
import { DATABASE_PLUGINS, PluginRegistry } from './plugin-registry';
import { PluginsController } from './plugins.controller';

/**
 * The installed database plugins. **This array is the only place a database type is named.**
 * To add one: write a lib that exports a `DatabasePlugin` (see libs/db-plugin and CLAUDE.md,
 * "Database plugins"), add it here, add its path to tsconfig.base.json. Nothing else changes.
 */
@Global()
@Module({
  controllers: [PluginsController],
  providers: [
    { provide: DATABASE_PLUGINS, useValue: [postgresPlugin, sqlitePlugin] },
    PluginRegistry,
    PluginHostFactory,
  ],
  exports: [PluginRegistry, PluginHostFactory],
})
export class PluginsModule {}
