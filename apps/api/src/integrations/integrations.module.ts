import { Global, Module } from '@nestjs/common';
import { DockerPort } from '../docker/ports/docker.port';
import { DockerCliAdapter } from './docker/docker-cli.adapter';
import { runProcess } from './process/run-process';

/**
 * Global: every outside-world port -> its adapter. Features depend on the port. Bound with
 * `useFactory` because the adapter's constructor takes a function (Nest cannot inject that).
 */
@Global()
@Module({
  providers: [
    { provide: DockerPort, useFactory: () => new DockerCliAdapter(runProcess) },
  ],
  exports: [DockerPort],
})
export class IntegrationsModule {}
