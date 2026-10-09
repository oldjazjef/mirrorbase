import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ConnectionsModule } from '../connections/connections.module';
import { ReplicationExecutor } from './application/replication-executor';
import { RUN_HANDLERS } from './application/run.handlers';
import { RunsController } from './runs.controller';

/** Runs: copy databases from one saved connection into another, in the background. */
@Module({
  imports: [CqrsModule, ConnectionsModule],
  controllers: [RunsController],
  providers: [ReplicationExecutor, ...RUN_HANDLERS],
})
export class ReplicationModule {}
