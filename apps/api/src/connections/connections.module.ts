import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CONNECTION_HANDLERS } from './application/connection.handlers';
import { ConnectionSecrets } from './application/secrets';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

/** Saved connections. The repository port is bound in the global PersistenceModule. */
@Module({
  imports: [CqrsModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, ConnectionSecrets, ...CONNECTION_HANDLERS],
  exports: [ConnectionSecrets],
})
export class ConnectionsModule {}
