import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  type DatabasePlugin,
  PluginError,
  type PluginConnection,
  type TestResult,
} from '@mirrorbase/db-plugin';
import {
  badRequest,
  conflict,
  notFound,
  unprocessable,
} from '../../common/http/api-errors';
import { PluginHostFactory } from '../../plugins/plugin-host';
import { PluginRegistry } from '../../plugins/plugin-registry';
import {
  cleanName,
  type Connection,
  ConnectionNameTakenError,
  MAX_NAME_LENGTH,
  normalizeConfig,
  pickSecrets,
  type StoredConnection,
} from '../domain/connection';
import { ConnectionRepositoryPort } from '../ports/connection.repository.port';
import { ConnectionSecrets } from './secrets';

/** A stored connection without its sealed values. */
export function publicView(stored: StoredConnection): Connection {
  const { sealedSecrets: _sealed, ...view } = stored;
  return view;
}

/** A plugin's typed failure as the HTTP error the app translates by `code`. */
export function pluginFailure(error: unknown): Error {
  if (error instanceof PluginError) {
    return unprocessable(error.code, error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function requireStored(
  stored: StoredConnection | null,
): StoredConnection {
  if (!stored) throw notFound('connectionNotFound', 'No such connection');
  return stored;
}

function checkName(raw: string): string {
  const name = cleanName(raw);
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw badRequest(
      'invalidName',
      `The name must be 1 to ${MAX_NAME_LENGTH} characters`,
    );
  }
  return name;
}

function checkValid(
  plugin: DatabasePlugin,
  connection: PluginConnection,
): void {
  const problems = plugin.validate(connection);
  if (problems.length > 0) {
    throw unprocessable(
      'invalidConnection',
      'The connection settings are invalid',
      {
        problems,
      },
    );
  }
}

async function saving<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ConnectionNameTakenError) {
      throw conflict('nameTaken', error.message);
    }
    throw error;
  }
}

// --- queries ---

export class ListConnectionsQuery {}

@QueryHandler(ListConnectionsQuery)
export class ListConnectionsHandler implements IQueryHandler<
  ListConnectionsQuery,
  Connection[]
> {
  constructor(private readonly connections: ConnectionRepositoryPort) {}

  async execute(_query?: ListConnectionsQuery): Promise<Connection[]> {
    return (await this.connections.list()).map(publicView);
  }
}

export class GetConnectionQuery {
  constructor(readonly id: string) {}
}

@QueryHandler(GetConnectionQuery)
export class GetConnectionHandler implements IQueryHandler<
  GetConnectionQuery,
  Connection
> {
  constructor(private readonly connections: ConnectionRepositoryPort) {}

  async execute({ id }: GetConnectionQuery): Promise<Connection> {
    return publicView(requireStored(await this.connections.find(id)));
  }
}

// --- create ---

export class CreateConnectionCommand {
  constructor(
    readonly name: string,
    readonly pluginId: string,
    readonly config: Readonly<Record<string, unknown>>,
    readonly secrets: Readonly<Record<string, unknown>> | undefined,
    readonly dockerName: string | undefined,
  ) {}
}

@CommandHandler(CreateConnectionCommand)
export class CreateConnectionHandler implements ICommandHandler<
  CreateConnectionCommand,
  Connection
> {
  constructor(
    private readonly connections: ConnectionRepositoryPort,
    private readonly registry: PluginRegistry,
    private readonly secrets: ConnectionSecrets,
  ) {}

  async execute(command: CreateConnectionCommand): Promise<Connection> {
    const plugin = this.registry.require(command.pluginId);
    const name = checkName(command.name);
    const config = normalizeConfig(plugin, command.config);
    const secrets = pickSecrets(plugin, command.secrets);
    checkValid(plugin, { config, secrets });
    const created = await saving(() =>
      this.connections.create({
        name,
        pluginId: plugin.id,
        config,
        sealedSecrets: this.secrets.seal(secrets),
        dockerName: command.dockerName?.trim() || null,
      }),
    );
    return publicView(created);
  }
}

// --- update ---

export class UpdateConnectionCommand {
  constructor(
    readonly id: string,
    readonly name: string | undefined,
    readonly config: Readonly<Record<string, unknown>> | undefined,
    /** New passwords; a key that is absent keeps its saved value. */
    readonly secrets: Readonly<Record<string, unknown>> | undefined,
    /** Secret keys to forget. */
    readonly clearSecrets: readonly string[] | undefined,
  ) {}
}

@CommandHandler(UpdateConnectionCommand)
export class UpdateConnectionHandler implements ICommandHandler<
  UpdateConnectionCommand,
  Connection
> {
  constructor(
    private readonly connections: ConnectionRepositoryPort,
    private readonly registry: PluginRegistry,
    private readonly secrets: ConnectionSecrets,
  ) {}

  async execute(command: UpdateConnectionCommand): Promise<Connection> {
    const existing = requireStored(await this.connections.find(command.id));
    const plugin = this.registry.require(existing.pluginId);

    const config = command.config
      ? normalizeConfig(plugin, command.config)
      : existing.config;
    const opened = this.secrets.open(existing);
    for (const key of command.clearSecrets ?? []) delete opened[key];
    const added = pickSecrets(plugin, command.secrets);
    const merged = { ...opened, ...added };
    checkValid(plugin, { config, secrets: merged });

    // Re-seal only what changed; untouched values keep their sealed form (and IV).
    const sealed: Record<string, string> = {};
    for (const [key, value] of Object.entries(merged)) {
      const keep = existing.sealedSecrets[key];
      sealed[key] =
        key in added || keep === undefined
          ? (Object.values(this.secrets.seal({ [key]: value }))[0] ?? '')
          : keep;
    }

    const updated = requireStored(
      await saving(() =>
        this.connections.update(command.id, {
          ...(command.name !== undefined
            ? { name: checkName(command.name) }
            : {}),
          config,
          sealedSecrets: sealed,
        }),
      ),
    );
    return publicView(updated);
  }
}

// --- delete ---

export class DeleteConnectionCommand {
  constructor(readonly id: string) {}
}

@CommandHandler(DeleteConnectionCommand)
export class DeleteConnectionHandler implements ICommandHandler<
  DeleteConnectionCommand,
  void
> {
  constructor(private readonly connections: ConnectionRepositoryPort) {}

  async execute({ id }: DeleteConnectionCommand): Promise<void> {
    if (!(await this.connections.delete(id))) {
      throw notFound('connectionNotFound', 'No such connection');
    }
  }
}

// --- test ---

export interface ConnectionTestResult extends TestResult {
  /** The plugin's error code when the test could not even run (tools missing, bad settings). */
  readonly code?: string;
}

export class TestConnectionCommand {
  constructor(
    readonly pluginId: string,
    readonly config: Readonly<Record<string, unknown>>,
    readonly secrets: Readonly<Record<string, unknown>> | undefined,
    /** An existing connection whose saved passwords fill the blanks (editing without retyping). */
    readonly connectionId: string | undefined,
    readonly role: 'source' | 'target',
  ) {}
}

/** Tests the values in the form - saved or not. Nothing is stored. */
@CommandHandler(TestConnectionCommand)
export class TestConnectionHandler implements ICommandHandler<
  TestConnectionCommand,
  ConnectionTestResult
> {
  constructor(
    private readonly connections: ConnectionRepositoryPort,
    private readonly registry: PluginRegistry,
    private readonly secrets: ConnectionSecrets,
    private readonly hosts: PluginHostFactory,
  ) {}

  async execute(command: TestConnectionCommand): Promise<ConnectionTestResult> {
    const plugin = this.registry.require(command.pluginId);
    const config = normalizeConfig(plugin, command.config);
    const typed = pickSecrets(plugin, command.secrets);
    let saved: Record<string, string> = {};
    if (command.connectionId) {
      const stored = requireStored(
        await this.connections.find(command.connectionId),
      );
      if (stored.pluginId !== plugin.id) {
        throw badRequest(
          'pluginMismatch',
          'The connection belongs to another database type',
        );
      }
      saved = this.secrets.open(stored);
    }
    const connection: PluginConnection = {
      config,
      secrets: { ...saved, ...typed },
    };
    checkValid(plugin, connection);

    const run = this.hosts.create({
      runId: null,
      secrets: Object.values(connection.secrets),
    });
    try {
      run.log.write(
        'info',
        `Testing a ${plugin.name} connection (${command.role})`,
      );
      const result = await plugin.testConnection(run.host, connection, {
        role: command.role,
      });
      run.log.write(
        result.ok ? 'info' : 'warn',
        result.ok
          ? `Connection OK${result.serverVersion ? `: ${result.serverVersion}` : ''}`
          : `Connection failed: ${result.message ?? 'unknown reason'}`,
      );
      return result;
    } catch (error) {
      if (error instanceof PluginError) {
        run.log.write(
          'warn',
          `Connection test could not run: ${error.message}`,
        );
        return { ok: false, message: error.message, code: error.code };
      }
      run.log.write('error', `Connection test crashed: ${String(error)}`);
      throw error;
    } finally {
      await run.dispose();
    }
  }
}

// --- databases of a saved connection ---

export class ListConnectionDatabasesQuery {
  constructor(readonly id: string) {}
}

@QueryHandler(ListConnectionDatabasesQuery)
export class ListConnectionDatabasesHandler implements IQueryHandler<
  ListConnectionDatabasesQuery,
  string[]
> {
  constructor(
    private readonly connections: ConnectionRepositoryPort,
    private readonly registry: PluginRegistry,
    private readonly secrets: ConnectionSecrets,
    private readonly hosts: PluginHostFactory,
  ) {}

  async execute({ id }: ListConnectionDatabasesQuery): Promise<string[]> {
    const stored = requireStored(await this.connections.find(id));
    const plugin = this.registry.require(stored.pluginId);
    const connection = this.secrets.toPluginConnection(stored);
    const run = this.hosts.create({
      runId: null,
      secrets: Object.values(connection.secrets),
    });
    try {
      return await plugin.listDatabases(run.host, connection);
    } catch (error) {
      run.log.write(
        'warn',
        `Could not list databases of "${stored.name}": ${String(error)}`,
      );
      throw pluginFailure(error);
    } finally {
      await run.dispose();
    }
  }
}

export const CONNECTION_HANDLERS = [
  ListConnectionsHandler,
  GetConnectionHandler,
  CreateConnectionHandler,
  UpdateConnectionHandler,
  DeleteConnectionHandler,
  TestConnectionHandler,
  ListConnectionDatabasesHandler,
];
