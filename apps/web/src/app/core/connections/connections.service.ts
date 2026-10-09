import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../actions/action';
import { ActionRunner } from '../actions/action-runner';
import { apiUrl } from '../api/api-url';
import type {
  Connection,
  ConnectionInput,
  ConnectionUpdate,
  DockerDatabases,
  TestRequest,
  TestResult,
} from '../api/api.types';

/**
 * The saved connections, shared by the Connections page and the Replicate page (both pick and
 * create them). Reads are `httpResource`; every change goes through the ActionRunner, which
 * reports pending / success / error and translates the API's error code into the toast.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionsService {
  private readonly http = inject(HttpClient);
  private readonly runner = inject(ActionRunner);

  readonly resource = httpResource<Connection[]>(() => apiUrl('/connections'));
  readonly docker = httpResource<DockerDatabases>(() =>
    apiUrl('/docker/databases'),
  );

  readonly connections = computed<readonly Connection[]>(() =>
    this.resource.hasValue() ? this.resource.value() : [],
  );

  find(id: string | null | undefined): Connection | undefined {
    return id ? this.connections().find((c) => c.id === id) : undefined;
  }

  reload(): void {
    this.resource.reload();
  }

  reloadDocker(): void {
    this.docker.reload();
  }

  private readonly createAction = defineAction<ConnectionInput, Connection>({
    run: (input) =>
      firstValueFrom(this.http.post<Connection>(apiUrl('/connections'), input)),
    messages: { success: 'connections.saved', error: 'connections.saveFailed' },
  });

  private readonly updateAction = defineAction<
    { id: string; update: ConnectionUpdate },
    Connection
  >({
    run: ({ id, update }) =>
      firstValueFrom(
        this.http.put<Connection>(apiUrl(`/connections/${id}`), update),
      ),
    messages: { success: 'connections.saved', error: 'connections.saveFailed' },
  });

  private readonly deleteAction = defineAction<string, void>({
    run: (id) =>
      firstValueFrom(this.http.delete<void>(apiUrl(`/connections/${id}`))),
    messages: {
      success: 'connections.deleted',
      error: 'connections.deleteFailed',
    },
  });

  async create(input: ConnectionInput): Promise<Connection> {
    const created = await this.runner.run(this.createAction, input);
    this.reload();
    this.reloadDocker();
    return created;
  }

  async update(id: string, update: ConnectionUpdate): Promise<Connection> {
    const updated = await this.runner.run(
      this.updateAction,
      { id, update },
      { key: `update:${id}` },
    );
    this.reload();
    this.reloadDocker();
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.runner.run(this.deleteAction, id, { key: `delete:${id}` });
    this.reload();
    this.reloadDocker();
  }

  isDeleting(id: string): boolean {
    return this.runner.status<void>(`delete:${id}`)()?.state === 'pending';
  }

  /** Tests the values of a form - saved or not. Never throws for a failed test, only for a crash. */
  test(request: TestRequest): Promise<TestResult> {
    return firstValueFrom(
      this.http.post<TestResult>(apiUrl('/connections/test'), request),
    );
  }

  /** The databases on a saved connection. */
  async databases(id: string): Promise<string[]> {
    const result = await firstValueFrom(
      this.http.post<{ databases: string[] }>(
        apiUrl(`/connections/${id}/databases`),
        null,
      ),
    );
    return result.databases;
  }
}
