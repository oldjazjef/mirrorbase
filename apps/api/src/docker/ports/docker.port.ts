import type { DockerContainer } from '@mirrorbase/db-plugin';

export type DockerUnavailableReason = 'notInstalled' | 'notRunning';

/** Docker cannot be asked: not installed, or the daemon is not running. */
export class DockerUnavailableError extends Error {
  constructor(
    readonly reason: DockerUnavailableReason,
    detail: string,
  ) {
    super(detail);
  }
}

/** The containers on this machine. Bound to its adapter in IntegrationsModule. */
export abstract class DockerPort {
  /** Every container, running or not (`state` tells). @throws DockerUnavailableError */
  abstract list(): Promise<DockerContainer[]>;
  /** Starts a stopped container. @throws DockerUnavailableError, Error with docker's message */
  abstract start(nameOrId: string): Promise<void>;
}
