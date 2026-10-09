import {
  type ConnectionPatch,
  ConnectionNameTakenError,
  type NewConnection,
  type StoredConnection,
} from '../domain/connection';
import { ConnectionRepositoryPort } from '../ports/connection.repository.port';

export class InMemoryConnectionRepository extends ConnectionRepositoryPort {
  readonly rows = new Map<string, StoredConnection>();
  private counter = 0;

  list(): Promise<StoredConnection[]> {
    return Promise.resolve(
      [...this.rows.values()].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  find(id: string): Promise<StoredConnection | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewConnection): Promise<StoredConnection> {
    this.assertFree(input.name);
    const now = new Date().toISOString();
    const row: StoredConnection = {
      id: `c${++this.counter}`,
      name: input.name,
      pluginId: input.pluginId,
      config: input.config,
      sealedSecrets: input.sealedSecrets,
      secretKeys: Object.keys(input.sealedSecrets),
      dockerName: input.dockerName,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(id: string, patch: ConnectionPatch): Promise<StoredConnection | null> {
    const existing = this.rows.get(id);
    if (!existing) return Promise.resolve(null);
    if (patch.name !== undefined && patch.name !== existing.name) {
      this.assertFree(patch.name);
    }
    const sealedSecrets = patch.sealedSecrets ?? existing.sealedSecrets;
    const row: StoredConnection = {
      ...existing,
      name: patch.name ?? existing.name,
      config: patch.config ?? existing.config,
      sealedSecrets,
      secretKeys: Object.keys(sealedSecrets),
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, row);
    return Promise.resolve(row);
  }

  delete(id: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  markUsed(id: string, at: Date): Promise<void> {
    const existing = this.rows.get(id);
    if (existing)
      this.rows.set(id, { ...existing, lastUsedAt: at.toISOString() });
    return Promise.resolve();
  }

  private assertFree(name: string): void {
    if ([...this.rows.values()].some((row) => row.name === name)) {
      throw new ConnectionNameTakenError(name);
    }
  }
}
