import type {
  DiscoveredEndpoint,
  DockerContainer,
} from '@mirrorbase/db-plugin';

const IMAGE_HINT = /postgres|postgis|timescale|pgvector|supabase\/postgres/i;

function imageRepository(image: string): string {
  const withoutTag = image.split('@')[0]?.replace(/:[^/:]+$/, '') ?? image;
  return withoutTag;
}

/** Postgres containers that publish 5432 on the host - the only ones this machine can reach. */
export function discoverPostgres(
  containers: readonly DockerContainer[],
): DiscoveredEndpoint[] {
  const found: DiscoveredEndpoint[] = [];
  for (const container of containers) {
    const looksLikePostgres =
      IMAGE_HINT.test(container.image) ||
      Object.keys(container.env).some((key) => key.startsWith('POSTGRES_'));
    if (!looksLikePostgres) continue;
    const binding = container.ports.find(
      (port) => port.containerPort === 5432 && port.protocol === 'tcp',
    );
    if (!binding) continue;
    const official = imageRepository(container.image) === 'postgres';
    const major = /^(\d+)/.exec(container.imageTag)?.[1];
    found.push({
      containerId: container.id,
      containerName: container.name,
      name: container.name,
      config: {
        host: 'localhost',
        port: binding.hostPort,
        user: container.env['POSTGRES_USER'] ?? 'postgres',
        maintenanceDb: container.env['POSTGRES_DB'] ?? 'postgres',
        // The client image should match the server's major version; only an official image's
        // tag says so reliably.
        pgImage: official && major ? major : 'latest',
      },
      summary: `${container.image} - port ${binding.hostPort}`,
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
