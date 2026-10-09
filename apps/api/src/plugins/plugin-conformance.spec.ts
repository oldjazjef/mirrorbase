import { validateFields } from '@dbreplicator/db-plugin';
import { postgresPlugin } from '@dbreplicator/plugin-postgres';
import { sqlitePlugin } from '@dbreplicator/plugin-sqlite';
import { PluginRegistry } from './plugin-registry';

const INSTALLED = [postgresPlugin, sqlitePlugin];

/**
 * Every installed plugin must satisfy the same rules. A new plugin added to plugins.module.ts
 * is only as good as its declaration: the UI and the API trust these invariants blindly.
 */
describe.each(INSTALLED.map((plugin) => [plugin.id, plugin] as const))(
  'plugin "%s"',
  (_id, plugin) => {
    it('has a stable id, a name, a version and an icon', () => {
      expect(plugin.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(plugin.name.length).toBeGreaterThan(0);
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(plugin.icon.length).toBeGreaterThan(0);
      expect(plugin.description.en.length).toBeGreaterThan(0);
    });

    it('declares unique, well-formed connection fields', () => {
      const keys = plugin.connectionFields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const field of plugin.connectionFields) {
        expect(field.label.en.length).toBeGreaterThan(0);
        if (field.secret) expect(field.type).toBe('password');
        if (field.type === 'select') {
          expect(field.options?.length ?? 0).toBeGreaterThan(0);
        }
        if (field.default !== undefined && field.type === 'select') {
          expect(
            field.options?.some(
              (option) => option.value === String(field.default),
            ),
          ).toBe(true);
        }
      }
    });

    it('validates its own defaults as a complete connection (apart from required blanks)', () => {
      const problems = validateFields(plugin.connectionFields, {
        config: {},
        secrets: {},
      });
      expect(problems.every((problem) => problem.code === 'required')).toBe(
        true,
      );
    });

    it('names a dump format and can be at least a source or a target', () => {
      expect(plugin.dumpFormat).toMatch(/@\d+$/);
      expect(
        plugin.capabilities.canBeSource || plugin.capabilities.canBeTarget,
      ).toBe(true);
    });

    it('implements docker discovery exactly when it says it does', () => {
      expect(typeof plugin.discoverDocker === 'function').toBe(
        plugin.capabilities.dockerDiscovery,
      );
    });
  },
);

describe('PluginRegistry', () => {
  it('finds plugins by id and sorts them by name', () => {
    const registry = new PluginRegistry(INSTALLED);
    expect(registry.all().map((plugin) => plugin.id)).toEqual([
      'postgres',
      'sqlite',
    ]);
    expect(registry.find('sqlite')).toBe(sqlitePlugin);
  });

  it('answers 404 for a plugin that is not installed', () => {
    expect(() => new PluginRegistry(INSTALLED).require('oracle')).toThrow(
      /No database plugin "oracle"/,
    );
  });

  it('refuses two plugins with the same id', () => {
    expect(() => new PluginRegistry([sqlitePlugin, sqlitePlugin])).toThrow(
      /share the id "sqlite"/,
    );
  });

  it('refuses an id that cannot be stored safely', () => {
    expect(
      () => new PluginRegistry([{ ...sqlitePlugin, id: 'Bad Id' }]),
    ).toThrow(/Invalid database plugin id/);
  });
});
