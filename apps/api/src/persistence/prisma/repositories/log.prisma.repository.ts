import { Injectable } from '@nestjs/common';
import {
  levelsFrom,
  type LogCriteria,
  type LogEntry,
  type LogLevel,
  type NewLogEntry,
} from '../../../logs/domain/log-entry';
import { LogRepositoryPort } from '../../../logs/ports/log.repository.port';
import type { LogEntry as Row } from '../../../generated/prisma/client';
import { iso } from '../mappers/json.mapper';
import { PrismaService } from '../prisma.service';

function toDomain(row: Row): LogEntry {
  return {
    id: row.id,
    runId: row.runId,
    level: row.level as LogLevel,
    message: row.message,
    at: iso(row.at),
  };
}

@Injectable()
export class LogPrismaRepository extends LogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async append(entries: readonly NewLogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.prisma.logEntry.createMany({
      data: entries.map((entry) => ({
        runId: entry.runId,
        level: entry.level,
        message: entry.message,
      })),
    });
  }

  async list(criteria: LogCriteria): Promise<LogEntry[]> {
    const polling = criteria.afterId !== undefined;
    const rows = await this.prisma.logEntry.findMany({
      where: {
        ...(criteria.runId ? { runId: criteria.runId } : {}),
        ...(criteria.appOnly ? { runId: null } : {}),
        ...(criteria.minLevel
          ? { level: { in: levelsFrom(criteria.minLevel) } }
          : {}),
        ...(polling || criteria.beforeId !== undefined
          ? {
              id: {
                ...(polling ? { gt: criteria.afterId } : {}),
                ...(criteria.beforeId !== undefined
                  ? { lt: criteria.beforeId }
                  : {}),
              },
            }
          : {}),
      },
      orderBy: { id: polling ? 'asc' : 'desc' },
      take: criteria.limit,
    });
    return rows.map(toDomain);
  }

  async prune(before: Date): Promise<number> {
    const result = await this.prisma.logEntry.deleteMany({
      where: { at: { lt: before } },
    });
    return result.count;
  }
}
