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

/** Read-only view of the containers on this machine. Bound to its adapter in IntegrationsModule. */
export abstract class DockerPort {
  /** Running containers. @throws DockerUnavailableError */
  abstract listRunning(): Promise<DockerContainer[]>;
}
