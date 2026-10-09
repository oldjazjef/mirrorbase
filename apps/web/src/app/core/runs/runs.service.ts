import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../api/api-url';
import type {
  LogEntry,
  LogLevel,
  Run,
  StartRunRequest,
} from '../api/api.types';

/** Runs and their log - plain reads and the two actions; pages poll through these. */
@Injectable({ providedIn: 'root' })
export class RunsService {
  private readonly http = inject(HttpClient);

  start(request: StartRunRequest): Promise<Run> {
    return firstValueFrom(this.http.post<Run>(apiUrl('/runs'), request));
  }

  cancel(id: string): Promise<Run> {
    return firstValueFrom(
      this.http.post<Run>(apiUrl(`/runs/${id}/cancel`), null),
    );
  }

  get(id: string): Promise<Run> {
    return firstValueFrom(this.http.get<Run>(apiUrl(`/runs/${id}`)));
  }

  list(limit = 50): Promise<Run[]> {
    return firstValueFrom(
      this.http.get<Run[]>(apiUrl('/runs'), { params: { limit } }),
    );
  }

  /** Newest first, or - with `afterId` - everything new since then, oldest first. */
  async log(options: {
    runId?: string;
    appOnly?: boolean;
    minLevel?: LogLevel;
    afterId?: number;
    limit?: number;
  }): Promise<LogEntry[]> {
    const params: Record<string, string | number> = {
      limit: options.limit ?? 200,
    };
    if (options.runId) params['runId'] = options.runId;
    if (options.appOnly) params['appOnly'] = 'true';
    if (options.minLevel) params['minLevel'] = options.minLevel;
    if (options.afterId !== undefined) params['afterId'] = options.afterId;
    const page = await firstValueFrom(
      this.http.get<{ items: LogEntry[] }>(apiUrl('/logs'), { params }),
    );
    return page.items;
  }
}
