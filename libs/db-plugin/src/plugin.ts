import type { DockerContainer, DiscoveredEndpoint } from './docker';
import type { FieldDescriptor, FieldProblem, PluginConnection } from './fields';
import type { HostContext } from './host';
import type { InterchangeAdapter } from './interchange';
import type { LocalizedText } from './text';

export interface PluginCapabilities {
  /** Can be chosen as the "from" side. */
  readonly canBeSource: boolean;
  /** Can be chosen as the "to" side. */
  readonly canBeTarget: boolean;
  /**
   * One server holds many databases (PostgreSQL) vs. the connection IS the database (a SQLite
   * file). Decides whether the app asks the user to pick databases.
   */
  readonly multipleDatabases: boolean;
  /** Implements `discoverDocker`. */
  readonly dockerDiscovery: boolean;
}

export interface TestResult {
  readonly ok: boolean;
  /** "PostgreSQL 16.4" — shown to the user. */
  readonly serverVersion?: string;
  /** Why not, in the tool's own words (already free of secrets). */
  readonly message?: string;
}

export interface TestOptions {
  /**
   * Which side the connection is for. A SQLite target may not exist yet; a source must. Defaults
   * to `source`.
   */
  readonly role?: 'source' | 'target';
}

export interface DumpRequest {
  readonly database: string;
  /** A directory the plugin may write into (`HostContext.workDir()`). */
  readonly outputDir: string;
}

/** What a dump produced: opaque to the app, handed back to `restore` of a compatible plugin. */
export interface DumpArtifact {
  readonly database: string;
  readonly file: string;
  readonly bytes: number;
  /** Equals the producing plugin's `dumpFormat`. */
  readonly format: string;
}

export interface RestoreRequest {
  /** The name the database gets on the target. */
  readonly database: string;
  readonly artifact: DumpArtifact;
  /** Drop an existing database of that name first. The app only sets it after confirmation. */
  readonly replaceExisting: boolean;
}

export interface RestoreResult {
  /** Non-fatal findings the tool reported (pg restore prints harmless warnings). */
  readonly warnings: number;
}

/**
 * One database type. The API collects every plugin, the UI draws forms from `connectionFields`,
 * and a replication calls these methods — none of them is specific to PostgreSQL or SQLite.
 *
 * A plugin throws `Error` with a message that is safe to show (no passwords); the host redacts
 * what it logs as well, but a plugin must not put secrets in messages in the first place.
 */
export interface DatabasePlugin {
  /** Stable id, stored with every connection: `postgres`, `sqlite`. Never rename. */
  readonly id: string;
  readonly name: string;
  readonly description: LocalizedText;
  readonly version: string;
  /** Name of an icon in the UI's icon set (`database`, `file`). */
  readonly icon: string;
  readonly capabilities: PluginCapabilities;
  readonly connectionFields: readonly FieldDescriptor[];
  /**
   * Identifies the native dump this plugin writes and reads. Two plugins with the same format
   * can copy into each other without the interchange step (`planTransfer`).
   */
  readonly dumpFormat: string;

  validate(connection: PluginConnection): FieldProblem[];
  testConnection(
    host: HostContext,
    connection: PluginConnection,
    options?: TestOptions,
  ): Promise<TestResult>;
  listDatabases(
    host: HostContext,
    connection: PluginConnection,
  ): Promise<string[]>;
  dump(
    host: HostContext,
    connection: PluginConnection,
    request: DumpRequest,
  ): Promise<DumpArtifact>;
  restore(
    host: HostContext,
    connection: PluginConnection,
    request: RestoreRequest,
  ): Promise<RestoreResult>;

  /** Recognise databases of this type among the running containers. */
  discoverDocker?(containers: readonly DockerContainer[]): DiscoveredEndpoint[];

  /** Optional: move data to and from OTHER database types (phase 2). */
  readonly interchange?: InterchangeAdapter;
}
