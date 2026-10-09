import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { planTransfer } from '@dbreplicator/db-plugin';
import {
  badRequest,
  conflict,
  notFound,
  unprocessable,
} from '../../common/http/api-errors';
import { ConnectionRepositoryPort } from '../../connections/ports/connection.repository.port';
import { LogService } from '../../logs/log.service';
import { PluginRegistry } from '../../plugins/plugin-registry';
import {
  isActive,
  type Run,
  type RunDatabase,
  sameEndpoint,
} from '../domain/run';
import { RunRepositoryPort } from '../ports/run.repository.port';
import { ReplicationExecutor } from './replication-executor';

const MAX_DATABASES = 100;

export interface DatabaseSelection {
  readonly source: string;
  /** The name on the target; defaults to the source name. */
  readonly target?: string;
}

export class StartRunCommand {
  constructor(
    readonly sourceId: string,
    readonly targetId: string,
    readonly databases: readonly DatabaseSelection[],
    readonly replaceExisting: boolean,
  ) {}
}

@CommandHandler(StartRunCommand)
export class StartRunHandler implements ICommandHandler<StartRunCommand, Run> {
  constructor(
    private readonly runs: RunRepositoryPort,
    private readonly connections: ConnectionRepositoryPort,
    private readonly registry: PluginRegistry,
    private readonly executor: ReplicationExecutor,
    private readonly logs: LogService,
  ) {}

  async execute(command: StartRunCommand): Promise<Run> {
    const [source, target] = await Promise.all([
      this.connections.find(command.sourceId),
      this.connections.find(command.targetId),
    ]);
    if (!source)
      throw notFound(
        'connectionNotFound',
        'The source connection does not exist',
      );
    if (!target)
      throw notFound(
        'connectionNotFound',
        'The target connection does not exist',
      );
    const sourcePlugin = this.registry.require(source.pluginId);
    const targetPlugin = this.registry.require(target.pluginId);

    const plan = planTransfer(sourcePlugin, targetPlugin);
    if (plan.kind === 'unsupported') {
      throw unprocessable(
        'transferUnsupported',
        `Cannot copy from ${sourcePlugin.name} to ${targetPlugin.name}`,
        {
          reason: plan.reason,
        },
      );
    }

    if (command.databases.length === 0) {
      throw badRequest('noDatabases', 'Select at least one database');
    }
    if (command.databases.length > MAX_DATABASES) {
      throw badRequest(
        'tooManyDatabases',
        `At most ${MAX_DATABASES} databases per run`,
      );
    }
    const databases: RunDatabase[] = command.databases.map((selection) => ({
      source: selection.source,
      target: (selection.target ?? selection.source).trim(),
      status: 'pending',
      bytes: null,
      warnings: 0,
      errorCode: null,
      error: null,
    }));
    if (databases.some((database) => database.target.length === 0)) {
      throw badRequest('invalidName', 'A target database name is empty');
    }
    if (new Set(databases.map((d) => d.target)).size !== databases.length) {
      throw badRequest(
        'duplicateTarget',
        'Two databases would land under the same name',
      );
    }
    // Replacing a database with itself would destroy the only copy.
    if (
      sameEndpoint(source, target) &&
      databases.some((database) => database.source === database.target)
    ) {
      throw unprocessable(
        'sameDatabase',
        'Source and target are the same server: choose a different target name or server',
      );
    }

    if (await this.runs.findActive()) {
      throw conflict('runInProgress', 'Another run is still in progress');
    }

    const run = await this.runs.create({
      sourceConnectionId: source.id,
      targetConnectionId: target.id,
      sourceName: source.name,
      targetName: target.name,
      sourcePluginId: source.pluginId,
      targetPluginId: target.pluginId,
      strategy: plan.kind,
      replaceExisting: command.replaceExisting,
      databases,
    });
    this.logs
      .writer(run.id)
      .write(
        'info',
        `Run queued: ${databases.map((d) => d.source).join(', ')}`,
      );
    this.executor.start(run.id);
    return run;
  }
}

export class CancelRunCommand {
  constructor(readonly id: string) {}
}

@CommandHandler(CancelRunCommand)
export class CancelRunHandler implements ICommandHandler<
  CancelRunCommand,
  Run
> {
  constructor(
    private readonly runs: RunRepositoryPort,
    private readonly executor: ReplicationExecutor,
    private readonly logs: LogService,
  ) {}

  async execute({ id }: CancelRunCommand): Promise<Run> {
    const run = await this.runs.find(id);
    if (!run) throw notFound('runNotFound', 'No such run');
    if (!isActive(run.status) || !this.executor.cancel(id)) {
      throw conflict('runNotActive', 'The run is not in progress');
    }
    this.logs.writer(id).write('warn', 'Cancel requested');
    return run;
  }
}

export class ListRunsQuery {
  constructor(readonly limit: number) {}
}

@QueryHandler(ListRunsQuery)
export class ListRunsHandler implements IQueryHandler<ListRunsQuery, Run[]> {
  constructor(private readonly runs: RunRepositoryPort) {}

  execute({ limit }: ListRunsQuery): Promise<Run[]> {
    return this.runs.list(limit);
  }
}

export class GetRunQuery {
  constructor(readonly id: string) {}
}

@QueryHandler(GetRunQuery)
export class GetRunHandler implements IQueryHandler<GetRunQuery, Run> {
  constructor(private readonly runs: RunRepositoryPort) {}

  async execute({ id }: GetRunQuery): Promise<Run> {
    const run = await this.runs.find(id);
    if (!run) throw notFound('runNotFound', 'No such run');
    return run;
  }
}

export const RUN_HANDLERS = [
  StartRunHandler,
  CancelRunHandler,
  ListRunsHandler,
  GetRunHandler,
];
