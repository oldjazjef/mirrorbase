import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ListDockerDatabasesHandler } from './application/docker.handlers';
import { DockerController } from './docker.controller';

@Module({
  imports: [CqrsModule],
  controllers: [DockerController],
  providers: [ListDockerDatabasesHandler],
})
export class DockerModule {}
