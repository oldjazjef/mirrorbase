import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  IpThrottlerGuard,
  throttlerOptions,
} from '../common/throttling/throttling';
import { validateEnv } from '../config/env';
import { ConnectionsModule } from '../connections/connections.module';
import { DockerModule } from '../docker/docker.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LogsModule } from '../logs/logs.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { PinLockGuard } from '../pin/pin-lock.guard';
import { PinModule } from '../pin/pin.module';
import { PluginsModule } from '../plugins/plugins.module';
import { ReplicationModule } from '../replication/replication.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // First match wins: a local override, then the developer's .env. Both git-ignored.
      envFilePath: ['apps/api/.env.local', 'apps/api/.env', '.env'],
      // The desktop app (apps/desktop) sets every variable itself before it loads this module; a
      // stray .env in whatever directory it was started from must not leak in.
      ignoreEnvFile: process.env['DR_IGNORE_ENV_FILE'] === 'true',
    }),
    // Per-IP hygiene (common/throttling).
    ThrottlerModule.forRootAsync({ useFactory: throttlerOptions }),
    // Global: every repository port → its Prisma adapter.
    PersistenceModule,
    // Global: outside-world ports (Docker) → their adapters.
    IntegrationsModule,
    // Global: the installed database plugins and the host they run through.
    PluginsModule,
    // Global: the log every slice writes to.
    LogsModule,
    PinModule,
    ConnectionsModule,
    DockerModule,
    ReplicationModule,
  ],
  controllers: [AppController],
  providers: [
    // Global guards run in registration order: the per-IP limit first, then the PIN lock - the
    // only authentication this app has. Both bound here so the order lives in one place.
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
    { provide: APP_GUARD, useExisting: PinLockGuard },
  ],
})
export class AppModule {}
