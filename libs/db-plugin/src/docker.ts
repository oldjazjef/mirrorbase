/** A running container as the docker adapter reports it — read only, no secrets. */
export interface DockerPortBinding {
  readonly containerPort: number;
  readonly protocol: string;
  readonly hostIp: string;
  readonly hostPort: number;
}

export interface DockerContainer {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  /** The tag of `image` (`16-alpine`), `latest` when none. */
  readonly imageTag: string;
  readonly state: string;
  readonly ports: readonly DockerPortBinding[];
  /**
   * Environment variables with their values, EXCEPT any whose name looks secret (PASS, SECRET,
   * TOKEN, KEY) — the adapter drops those, so a plugin cannot leak what it never sees.
   */
  readonly env: Readonly<Record<string, string>>;
}

/** A database a plugin recognised in a container. */
export interface DiscoveredEndpoint {
  readonly containerId: string;
  readonly containerName: string;
  /** Suggested connection name. */
  readonly name: string;
  /** Non-secret settings to prefill; the user adds the password. */
  readonly config: Readonly<Record<string, string | number | boolean>>;
  /** Short facts for the list ("postgres:16-alpine", "port 5433"). */
  readonly summary: string;
}
