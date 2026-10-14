import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ContainerStarter } from './application/container-starter';
import { CONNECTION_HANDLERS } from './application/connection.handlers';
import { CONNECTION_TRANSFER_HANDLERS } from './application/connection-transfer.handlers';
import { ConnectionSecrets } from './application/secrets';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

/** Saved connections. The repository port is bound in the global PersistenceModule. */
@Module({
  imports: [CqrsModule],
  controllers: [ConnectionsController],
  providers: [
    ConnectionsService,
    ConnectionSecrets,
    ContainerStarter,
    ...CONNECTION_HANDLERS,
    ...CONNECTION_TRANSFER_HANDLERS,
  ],
  exports: [ConnectionSecrets, ContainerStarter],
})
export class ConnectionsModule {}
