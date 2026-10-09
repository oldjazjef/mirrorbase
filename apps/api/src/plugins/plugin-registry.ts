import { Inject, Injectable } from '@nestjs/common';
import type { DatabasePlugin } from '@dbreplicator/db-plugin';
import { notFound } from '../common/http/api-errors';

/** DI token for the list of installed database plugins (see plugins.module.ts). */
export const DATABASE_PLUGINS = Symbol('DATABASE_PLUGINS');

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Every database type the app can talk to. The rest of the API never names a database: it asks
 * the registry for the plugin a connection stores. Registering a plugin is one line in
 * plugins.module.ts - connections, the replicate page and the docker list pick it up from here.
 */
@Injectable()
export class PluginRegistry {
  private readonly byId = new Map<string, DatabasePlugin>();

  constructor(@Inject(DATABASE_PLUGINS) plugins: readonly DatabasePlugin[]) {
    for (const plugin of plugins) {
      if (!ID_PATTERN.test(plugin.id)) {
        throw new Error(
          `Invalid database plugin id: ${JSON.stringify(plugin.id)}`,
        );
      }
      if (this.byId.has(plugin.id)) {
        throw new Error(`Two database plugins share the id "${plugin.id}"`);
      }
      this.byId.set(plugin.id, plugin);
    }
  }

  all(): DatabasePlugin[] {
    return [...this.byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  find(id: string): DatabasePlugin | undefined {
    return this.byId.get(id);
  }

  /** The plugin, or a 404 `unknownPlugin` - a stored connection may name one that was removed. */
  require(id: string): DatabasePlugin {
    const plugin = this.byId.get(id);
    if (!plugin) {
      throw notFound(
        'unknownPlugin',
        `No database plugin "${id}" is installed`,
      );
    }
    return plugin;
  }
}
