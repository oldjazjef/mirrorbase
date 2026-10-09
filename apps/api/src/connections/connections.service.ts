import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  type ConnectionTestResult,
  CreateConnectionCommand,
  DeleteConnectionCommand,
  GetConnectionQuery,
  ListConnectionDatabasesQuery,
  ListConnectionsQuery,
  TestConnectionCommand,
  UpdateConnectionCommand,
} from './application/connection.handlers';
import type { Connection } from './domain/connection';
import type {
  CreateConnectionDto,
  TestConnectionDto,
  UpdateConnectionDto,
} from './dto/connection.dto';

/** Thin façade over the buses so the controller stays free of CQRS. */
@Injectable()
export class ConnectionsService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  list(): Promise<Connection[]> {
    return this.queries.execute(new ListConnectionsQuery());
  }

  get(id: string): Promise<Connection> {
    return this.queries.execute(new GetConnectionQuery(id));
  }

  create(dto: CreateConnectionDto): Promise<Connection> {
    return this.commands.execute(
      new CreateConnectionCommand(
        dto.name,
        dto.pluginId,
        dto.config,
        dto.secrets,
        dto.dockerName,
      ),
    );
  }

  update(id: string, dto: UpdateConnectionDto): Promise<Connection> {
    return this.commands.execute(
      new UpdateConnectionCommand(
        id,
        dto.name,
        dto.config,
        dto.secrets,
        dto.clearSecrets,
      ),
    );
  }

  remove(id: string): Promise<void> {
    return this.commands.execute(new DeleteConnectionCommand(id));
  }

  test(dto: TestConnectionDto): Promise<ConnectionTestResult> {
    return this.commands.execute(
      new TestConnectionCommand(
        dto.pluginId,
        dto.config,
        dto.secrets,
        dto.connectionId,
        dto.role ?? 'source',
      ),
    );
  }

  databases(id: string): Promise<string[]> {
    return this.queries.execute(new ListConnectionDatabasesQuery(id));
  }
}
