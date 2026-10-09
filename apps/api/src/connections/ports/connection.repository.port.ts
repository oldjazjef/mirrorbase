import type {
  ConnectionPatch,
  NewConnection,
  StoredConnection,
} from '../domain/connection';

/** Contract and DI token in one - bound to its Prisma adapter in PersistenceModule. */
export abstract class ConnectionRepositoryPort {
  /** Newest first by name. */
  abstract list(): Promise<StoredConnection[]>;
  abstract find(id: string): Promise<StoredConnection | null>;
  /** @throws ConnectionNameTakenError */
  abstract create(input: NewConnection): Promise<StoredConnection>;
  /** @throws ConnectionNameTakenError. Null when the connection is gone. */
  abstract update(
    id: string,
    patch: ConnectionPatch,
  ): Promise<StoredConnection | null>;
  abstract delete(id: string): Promise<boolean>;
  abstract markUsed(id: string, at: Date): Promise<void>;
}
