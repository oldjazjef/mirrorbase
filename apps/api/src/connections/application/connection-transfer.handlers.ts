import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import {
  decryptEnvelope,
  type EncryptedEnvelope,
  encryptEnvelope,
  MIN_EXPORT_PASSWORD_LENGTH,
  WrongExportPasswordError,
} from '../../common/crypto/export-envelope';
import { badRequest, unprocessable } from '../../common/http/api-errors';
import { PluginRegistry } from '../../plugins/plugin-registry';
import {
  cleanName,
  MAX_NAME_LENGTH,
  normalizeConfig,
  pickSecrets,
} from '../domain/connection';
import { ConnectionNameTakenError } from '../domain/connection';
import { ConnectionRepositoryPort } from '../ports/connection.repository.port';
import { checkGroup } from './connection.handlers';
import { ConnectionSecrets } from './secrets';

/** One connection as it travels in an export file. `secrets` only when passwords were included. */
export interface ExportedConnection {
  readonly name: string;
  readonly pluginId: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly dockerName: string | null;
  readonly group: string | null;
  readonly secrets?: Readonly<Record<string, string>>;
}

export interface PlainExport {
  readonly app: 'mirrorbase';
  readonly kind: 'connections';
  readonly version: 1;
  readonly encrypted: false;
  readonly exportedAt: string;
  readonly connections: readonly ExportedConnection[];
}

export type ConnectionExport = PlainExport | EncryptedEnvelope;

// --- export ---

export class ExportConnectionsQuery {
  constructor(
    /** undefined = every connection. */
    readonly ids: readonly string[] | undefined,
    readonly includePasswords: boolean,
    /** Encrypts the file. Required when passwords are included. */
    readonly password: string | undefined,
  ) {}
}

@QueryHandler(ExportConnectionsQuery)
export class ExportConnectionsHandler implements IQueryHandler<
  ExportConnectionsQuery,
  ConnectionExport
> {
  constructor(
    private readonly connections: ConnectionRepositoryPort,
    private readonly secrets: ConnectionSecrets,
  ) {}

  async execute(query: ExportConnectionsQuery): Promise<ConnectionExport> {
    const password = query.password ?? '';
    if (query.includePasswords && password.length === 0) {
      throw badRequest(
        'exportPasswordRequired',
        'Passwords can only be exported encrypted: set an export password',
      );
    }
    if (password.length > 0 && password.length < MIN_EXPORT_PASSWORD_LENGTH) {
      throw badRequest(
        'exportPasswordTooShort',
        `The export password needs at least ${MIN_EXPORT_PASSWORD_LENGTH} characters`,
      );
    }

    const wanted = query.ids ? new Set(query.ids) : null;
    const stored = (await this.connections.list()).filter(
      (connection) => !wanted || wanted.has(connection.id),
    );
    const payload: PlainExport = {
      app: 'mirrorbase',
      kind: 'connections',
      version: 1,
      encrypted: false,
      exportedAt: new Date().toISOString(),
      connections: stored.map((connection) => ({
        name: connection.name,
        pluginId: connection.pluginId,
        config: connection.config,
        dockerName: connection.dockerName,
        group: connection.group,
        ...(query.includePasswords
          ? { secrets: this.secrets.open(connection) }
          : {}),
      })),
    };
    return password.length > 0
      ? encryptEnvelope(JSON.stringify(payload), password)
      : payload;
  }
}

// --- import ---

export class ImportConnectionsCommand {
  constructor(
    /** The text of an export file. */
    readonly content: string,
    readonly password: string | undefined,
  ) {}
}

export interface ImportResult {
  readonly imported: number;
  /** Of the imported, how many had to be renamed because the name was taken. */
  readonly renamed: number;
  readonly skipped: readonly { name: string; reason: string }[];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw unprocessable('invalidExportFile', 'This is not a Mirrorbase export');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMirrorbaseExport(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value['app'] === 'mirrorbase' &&
    value['kind'] === 'connections' &&
    value['version'] === 1
  );
}

@CommandHandler(ImportConnectionsCommand)
export class ImportConnectionsHandler implements ICommandHandler<
  ImportConnectionsCommand,
  ImportResult
> {
  constructor(
    private readonly connections: ConnectionRepositoryPort,
    private readonly registry: PluginRegistry,
    private readonly secrets: ConnectionSecrets,
  ) {}

  async execute(command: ImportConnectionsCommand): Promise<ImportResult> {
    let file = parseJson(command.content);
    if (!isMirrorbaseExport(file)) {
      throw unprocessable(
        'invalidExportFile',
        'This is not a Mirrorbase export',
      );
    }
    if (file['encrypted'] === true) {
      if (!command.password) {
        throw unprocessable(
          'exportPasswordRequired',
          'This export is encrypted: enter its password',
        );
      }
      try {
        file = parseJson(
          decryptEnvelope(
            file as unknown as EncryptedEnvelope,
            command.password,
          ),
        );
      } catch (error) {
        if (error instanceof WrongExportPasswordError) {
          throw unprocessable('wrongExportPassword', error.message);
        }
        throw error;
      }
      if (!isMirrorbaseExport(file)) {
        throw unprocessable(
          'invalidExportFile',
          'This is not a Mirrorbase export',
        );
      }
    }
    const entries = file['connections'];
    if (!Array.isArray(entries)) {
      throw unprocessable(
        'invalidExportFile',
        'This is not a Mirrorbase export',
      );
    }

    const taken = new Set((await this.connections.list()).map((c) => c.name));
    let imported = 0;
    let renamed = 0;
    const skipped: { name: string; reason: string }[] = [];

    for (const entry of entries as unknown[]) {
      if (!isRecord(entry) || typeof entry['name'] !== 'string') {
        skipped.push({ name: '?', reason: 'invalidEntry' });
        continue;
      }
      const wantedName = cleanName(entry['name']).slice(0, MAX_NAME_LENGTH);
      const pluginId = entry['pluginId'];
      const plugin =
        typeof pluginId === 'string' ? this.registry.find(pluginId) : undefined;
      if (wantedName.length === 0 || !plugin || !isRecord(entry['config'])) {
        skipped.push({
          name: wantedName || '?',
          reason:
            plugin || typeof pluginId !== 'string'
              ? 'invalidEntry'
              : 'unknownPlugin',
        });
        continue;
      }

      const name = freeName(wantedName, taken);
      const secrets = pickSecrets(
        plugin,
        isRecord(entry['secrets']) ? entry['secrets'] : undefined,
      );
      try {
        await this.connections.create({
          name,
          pluginId: plugin.id,
          config: normalizeConfig(plugin, entry['config']),
          sealedSecrets: this.secrets.seal(secrets),
          dockerName:
            typeof entry['dockerName'] === 'string'
              ? entry['dockerName'].trim() || null
              : null,
          group: checkGroup(
            typeof entry['group'] === 'string' ? entry['group'] : null,
          ),
        });
      } catch (error) {
        if (error instanceof ConnectionNameTakenError) {
          skipped.push({ name, reason: 'nameTaken' });
          continue;
        }
        throw error;
      }
      taken.add(name);
      imported += 1;
      if (name !== wantedName) renamed += 1;
    }
    return { imported, renamed, skipped };
  }
}

/** `Prod` → `Prod (2)` → `Prod (3)` …, within the name length limit. */
function freeName(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${wanted.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const CONNECTION_TRANSFER_HANDLERS = [
  ExportConnectionsHandler,
  ImportConnectionsHandler,
];
