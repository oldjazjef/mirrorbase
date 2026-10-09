import { Injectable } from '@nestjs/common';
import type { ConnectionConfig } from '@mirrorbase/db-plugin';
import {
  type ConnectionPatch,
  ConnectionNameTakenError,
  type NewConnection,
  type StoredConnection,
} from '../../../connections/domain/connection';
import { ConnectionRepositoryPort } from '../../../connections/ports/connection.repository.port';
import { SealedSecretsEraserPort } from '../../../pin/ports/app-pin.repository.port';
import type { Connection as Row } from '../../../generated/prisma/client';
import { iso, isoOrNull, parseObject } from '../mappers/json.mapper';
import { PrismaService } from '../prisma.service';

function toDomain(row: Row): StoredConnection {
  const sealedSecrets = parseObject<Record<string, string>>(row.secrets);
  return {
    id: row.id,
    name: row.name,
    pluginId: row.pluginId,
    config: parseObject<ConnectionConfig>(row.config),
    secretKeys: Object.keys(sealedSecrets),
    sealedSecrets,
    dockerName: row.dockerName,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    lastUsedAt: isoOrNull(row.lastUsedAt),
  };
}

/** Prisma's unique-constraint violation, without importing its error class. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class ConnectionPrismaRepository extends ConnectionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(): Promise<StoredConnection[]> {
    const rows = await this.prisma.connection.findMany({
      orderBy: { name: 'asc' },
    });
    return rows.map(toDomain);
  }

  async find(id: string): Promise<StoredConnection | null> {
    const row = await this.prisma.connection.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async create(input: NewConnection): Promise<StoredConnection> {
    try {
      const row = await this.prisma.connection.create({
        data: {
          name: input.name,
          pluginId: input.pluginId,
          config: JSON.stringify(input.config),
          secrets: JSON.stringify(input.sealedSecrets),
          dockerName: input.dockerName,
        },
      });
      return toDomain(row);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConnectionNameTakenError(input.name);
      throw error;
    }
  }

  async update(
    id: string,
    patch: ConnectionPatch,
  ): Promise<StoredConnection | null> {
    try {
      // updateMany: a missing row is a count of 0, not an exception to catch.
      const result = await this.prisma.connection.updateMany({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.config !== undefined
            ? { config: JSON.stringify(patch.config) }
            : {}),
          ...(patch.sealedSecrets !== undefined
            ? { secrets: JSON.stringify(patch.sealedSecrets) }
            : {}),
        },
      });
      return result.count === 0 ? null : this.find(id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConnectionNameTakenError(patch.name ?? '');
      }
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.prisma.connection.deleteMany({ where: { id } });
    return result.count > 0;
  }

  async markUsed(id: string, at: Date): Promise<void> {
    await this.prisma.connection.updateMany({
      where: { id },
      data: { lastUsedAt: at },
    });
  }
}

/** "PIN forgotten": every saved password goes. */
@Injectable()
export class SealedSecretsEraserPrismaRepository extends SealedSecretsEraserPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async eraseAll(): Promise<number> {
    const result = await this.prisma.connection.updateMany({
      where: { NOT: { secrets: '{}' } },
      data: { secrets: '{}' },
    });
    return result.count;
  }
}
