import { Injectable } from '@nestjs/common';
import type { Run as Row } from '../../../generated/prisma/client';
import type {
  NewRun,
  Run,
  RunDatabase,
  RunPatch,
  RunStatus,
  RunStrategy,
} from '../../../replication/domain/run';
import { RunRepositoryPort } from '../../../replication/ports/run.repository.port';
import { iso, isoOrNull, parseArray } from '../mappers/json.mapper';
import { PrismaService } from '../prisma.service';

function toDomain(row: Row): Run {
  return {
    id: row.id,
    status: row.status as RunStatus,
    sourceConnectionId: row.sourceConnectionId,
    targetConnectionId: row.targetConnectionId,
    sourceName: row.sourceName,
    targetName: row.targetName,
    sourcePluginId: row.sourcePluginId,
    targetPluginId: row.targetPluginId,
    strategy: row.strategy as RunStrategy,
    replaceExisting: row.replaceExisting,
    databases: parseArray<RunDatabase>(row.databases),
    error: row.error,
    createdAt: iso(row.createdAt),
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
  };
}

@Injectable()
export class RunPrismaRepository extends RunRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: NewRun): Promise<Run> {
    const row = await this.prisma.run.create({
      data: {
        sourceConnectionId: input.sourceConnectionId,
        targetConnectionId: input.targetConnectionId,
        sourceName: input.sourceName,
        targetName: input.targetName,
        sourcePluginId: input.sourcePluginId,
        targetPluginId: input.targetPluginId,
        strategy: input.strategy,
        replaceExisting: input.replaceExisting,
        databases: JSON.stringify(input.databases),
      },
    });
    return toDomain(row);
  }

  async find(id: string): Promise<Run | null> {
    const row = await this.prisma.run.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async list(limit: number): Promise<Run[]> {
    const rows = await this.prisma.run.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async update(id: string, patch: RunPatch): Promise<Run | null> {
    const result = await this.prisma.run.updateMany({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.databases !== undefined
          ? { databases: JSON.stringify(patch.databases) }
          : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.startedAt !== undefined
          ? { startedAt: patch.startedAt }
          : {}),
        ...(patch.finishedAt !== undefined
          ? { finishedAt: patch.finishedAt }
          : {}),
      },
    });
    return result.count === 0 ? null : this.find(id);
  }

  async findActive(): Promise<Run | null> {
    const row = await this.prisma.run.findFirst({
      where: { status: { in: ['queued', 'running'] } },
    });
    return row ? toDomain(row) : null;
  }

  async failInterrupted(at: Date, reason: string): Promise<number> {
    const result = await this.prisma.run.updateMany({
      where: { status: { in: ['queued', 'running'] } },
      data: { status: 'failed', error: reason, finishedAt: at },
    });
    return result.count;
  }
}
