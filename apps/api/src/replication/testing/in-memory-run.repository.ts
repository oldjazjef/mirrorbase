import type { NewRun, Run, RunPatch } from '../domain/run';
import { RunRepositoryPort } from '../ports/run.repository.port';

export class InMemoryRunRepository extends RunRepositoryPort {
  readonly rows = new Map<string, Run>();
  /** Every state a run went through, for asserting progress. */
  readonly history: Run[] = [];
  private counter = 0;

  create(input: NewRun): Promise<Run> {
    const run: Run = {
      id: `r${++this.counter}`,
      status: 'queued',
      ...input,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    this.rows.set(run.id, run);
    this.history.push(run);
    return Promise.resolve(run);
  }

  find(id: string): Promise<Run | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  list(limit: number): Promise<Run[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
    );
  }

  update(id: string, patch: RunPatch): Promise<Run | null> {
    const existing = this.rows.get(id);
    if (!existing) return Promise.resolve(null);
    const run: Run = {
      ...existing,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.databases !== undefined ? { databases: patch.databases } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.startedAt !== undefined
        ? { startedAt: patch.startedAt.toISOString() }
        : {}),
      ...(patch.finishedAt !== undefined
        ? { finishedAt: patch.finishedAt.toISOString() }
        : {}),
    };
    this.rows.set(id, run);
    this.history.push(run);
    return Promise.resolve(run);
  }

  findActive(): Promise<Run | null> {
    return Promise.resolve(
      [...this.rows.values()].find(
        (run) => run.status === 'queued' || run.status === 'running',
      ) ?? null,
    );
  }

  failInterrupted(at: Date, reason: string): Promise<number> {
    let count = 0;
    for (const run of this.rows.values()) {
      if (run.status === 'queued' || run.status === 'running') {
        this.rows.set(run.id, {
          ...run,
          status: 'failed',
          error: reason,
          finishedAt: at.toISOString(),
        });
        count++;
      }
    }
    return Promise.resolve(count);
  }
}
