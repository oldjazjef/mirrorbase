import { Global, Module } from '@nestjs/common';
import { ConnectionRepositoryPort } from '../connections/ports/connection.repository.port';
import { LogRepositoryPort } from '../logs/ports/log.repository.port';
import {
  AppPinRepositoryPort,
  SealedSecretsEraserPort,
} from '../pin/ports/app-pin.repository.port';
import { RunRepositoryPort } from '../replication/ports/run.repository.port';
import { PrismaService } from './prisma/prisma.service';
import { AppPinPrismaRepository } from './prisma/repositories/app-pin.prisma.repository';
import {
  ConnectionPrismaRepository,
  SealedSecretsEraserPrismaRepository,
} from './prisma/repositories/connection.prisma.repository';
import { LogPrismaRepository } from './prisma/repositories/log.prisma.repository';
import { RunPrismaRepository } from './prisma/repositories/run.prisma.repository';

/**
 * Global: every repository port → its Prisma adapter. A feature module declares the port it
 * needs and never names an adapter, so swapping the database is a change in this file alone.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    { provide: ConnectionRepositoryPort, useClass: ConnectionPrismaRepository },
    {
      provide: SealedSecretsEraserPort,
      useClass: SealedSecretsEraserPrismaRepository,
    },
    { provide: RunRepositoryPort, useClass: RunPrismaRepository },
    { provide: LogRepositoryPort, useClass: LogPrismaRepository },
    { provide: AppPinRepositoryPort, useClass: AppPinPrismaRepository },
  ],
  exports: [
    ConnectionRepositoryPort,
    SealedSecretsEraserPort,
    RunRepositoryPort,
    LogRepositoryPort,
    AppPinRepositoryPort,
  ],
})
export class PersistenceModule {}
