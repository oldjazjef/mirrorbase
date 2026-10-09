import { Injectable } from '@nestjs/common';
import type { AppPin, SaveAppPinInput } from '../../../pin/domain/pin';
import { AppPinRepositoryPort } from '../../../pin/ports/app-pin.repository.port';
import type { AppPin as Row } from '../../../generated/prisma/client';
import { iso, isoOrNull } from '../mappers/json.mapper';
import { PrismaService } from '../prisma.service';

const SINGLETON = 1;

function toDomain(row: Row): AppPin {
  return {
    pinHash: row.pinHash,
    failedAttempts: row.failedAttempts,
    nextAttemptAt: isoOrNull(row.nextAttemptAt),
    autoLockMinutes: row.autoLockMinutes,
    updatedAt: iso(row.updatedAt),
  };
}

@Injectable()
export class AppPinPrismaRepository extends AppPinRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(): Promise<AppPin | null> {
    const row = await this.prisma.appPin.findUnique({
      where: { id: SINGLETON },
    });
    return row ? toDomain(row) : null;
  }

  async save(input: SaveAppPinInput): Promise<AppPin> {
    const data = {
      pinHash: input.pinHash,
      failedAttempts: input.failedAttempts,
      nextAttemptAt: input.nextAttemptAt ? new Date(input.nextAttemptAt) : null,
      autoLockMinutes: input.autoLockMinutes,
    };
    const row = await this.prisma.appPin.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, ...data },
      update: data,
    });
    return toDomain(row);
  }

  async delete(): Promise<void> {
    await this.prisma.appPin.deleteMany({ where: { id: SINGLETON } });
  }
}
