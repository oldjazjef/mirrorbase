import type { NewRun, Run, RunPatch } from '../domain/run';

/** Contract and DI token in one - bound to its Prisma adapter in PersistenceModule. */
export abstract class RunRepositoryPort {
  abstract create(input: NewRun): Promise<Run>;
  abstract find(id: string): Promise<Run | null>;
  /** Newest first. */
  abstract list(limit: number): Promise<Run[]>;
  abstract update(id: string, patch: RunPatch): Promise<Run | null>;
  /** The run that is queued or running, if any. */
  abstract findActive(): Promise<Run | null>;
  /** Marks every queued/running run failed (the app was closed mid-run); returns how many. */
  abstract failInterrupted(at: Date, reason: string): Promise<number>;
}
