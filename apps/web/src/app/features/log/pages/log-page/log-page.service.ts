import { Injectable, computed, inject, signal } from '@angular/core';
import { isActiveRun, type Run } from '../../../../core/api/api.types';
import { RunsService } from '../../../../core/runs/runs.service';

/**
 * The Log page: the history of runs and, for the one selected (or the app itself), its log.
 * `null` as the selection means the app's own entries (start-up, connection tests).
 */
@Injectable({ providedIn: 'root' })
export class LogPageService {
  private readonly runsApi = inject(RunsService);

  readonly runs = signal<readonly Run[]>([]);
  readonly loaded = signal(false);
  readonly failed = signal(false);
  readonly selectedId = signal<string | null>(null);

  readonly selected = computed<Run | null>(
    () => this.runs().find((run) => run.id === this.selectedId()) ?? null,
  );
  /** The log keeps polling while the run is in progress, and always for the app's own log. */
  readonly live = computed(() => {
    const run = this.selected();
    return run === null ? this.selectedId() === null : isActiveRun(run.status);
  });

  select(id: string | null | undefined): void {
    this.selectedId.set(id ?? null);
  }

  async refresh(): Promise<void> {
    try {
      this.runs.set(await this.runsApi.list(50));
      this.failed.set(false);
    } catch {
      this.failed.set(true);
    } finally {
      this.loaded.set(true);
    }
  }
}
