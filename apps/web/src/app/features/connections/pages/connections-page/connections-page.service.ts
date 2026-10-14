import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  Connection,
  DockerDatabase,
  Plugin,
} from '../../../../core/api/api.types';
import { ConnectionsService } from '../../../../core/connections/connections.service';
import { PluginsService } from '../../../../core/plugins/plugins.service';
import type { ConnectionPrefill } from '../../../../shared/components/connection-dialog';
import { summarizeConfig } from '../../../../shared/format/format';

/** A run of connections under one heading; `name` is null for the ungrouped ones. */
export interface ConnectionGroup {
  readonly name: string | null;
  readonly rows: readonly ConnectionRow[];
}

export interface ConnectionRow {
  readonly connection: Connection;
  readonly pluginName: string;
  readonly target: string;
  readonly hasPassword: boolean;
}

const DOCKER_PAGE_SIZE = 5;

/** UI state of the Connections page; the data itself comes from the shared ConnectionsService. */
@Injectable({ providedIn: 'root' })
export class ConnectionsPageService {
  readonly data = inject(ConnectionsService);
  private readonly plugins = inject(PluginsService);

  readonly dialogOpen = signal(false);
  readonly exportOpen = signal(false);
  readonly importOpen = signal(false);
  readonly editing = signal<Connection | null>(null);
  readonly prefill = signal<ConnectionPrefill | null>(null);
  readonly deleting = signal<Connection | null>(null);

  readonly dockerPage = signal(0);

  /** The detected containers, as many as the list holds. */
  private readonly dockerItems = computed<readonly DockerDatabase[]>(() => {
    const docker = this.data.docker.hasValue()
      ? this.data.docker.value()
      : null;
    return docker?.available ? docker.items : [];
  });

  readonly dockerPageCount = computed(() =>
    Math.max(1, Math.ceil(this.dockerItems().length / DOCKER_PAGE_SIZE)),
  );

  /** The page shown; a list that got shorter after a refresh falls back to its last page. */
  readonly dockerPageIndex = computed(() =>
    Math.min(this.dockerPage(), this.dockerPageCount() - 1),
  );

  readonly dockerPageItems = computed<readonly DockerDatabase[]>(() => {
    const start = this.dockerPageIndex() * DOCKER_PAGE_SIZE;
    return this.dockerItems().slice(start, start + DOCKER_PAGE_SIZE);
  });

  moveDockerPage(step: number): void {
    this.dockerPage.set(
      Math.min(
        Math.max(this.dockerPageIndex() + step, 0),
        this.dockerPageCount() - 1,
      ),
    );
  }

  readonly rows = computed<readonly ConnectionRow[]>(() =>
    this.data.connections().map((connection) => ({
      connection,
      pluginName:
        this.plugins.find(connection.pluginId)?.name ?? connection.pluginId,
      target: summarizeConfig(connection.config),
      hasPassword: connection.secretKeys.length > 0,
    })),
  );

  /** Named groups A-Z, then the ungrouped. Headings only show when some group exists. */
  readonly groups = computed<readonly ConnectionGroup[]>(() => {
    const byGroup = new Map<string | null, ConnectionRow[]>();
    for (const row of this.rows()) {
      const key = row.connection.group;
      byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
    }
    const named = [...byGroup.keys()]
      .filter((key): key is string => key !== null)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, rows: byGroup.get(name) ?? [] }));
    const ungrouped = byGroup.get(null);
    return ungrouped ? [...named, { name: null, rows: ungrouped }] : named;
  });

  readonly hasGroups = computed(() =>
    this.groups().some((group) => group.name !== null),
  );

  readonly isEmpty = computed(
    () => this.data.resource.hasValue() && this.data.connections().length === 0,
  );

  /** Plugin ids with a name, for the badge when the plugin is no longer installed. */
  pluginOf(id: string): Plugin | undefined {
    return this.plugins.find(id);
  }

  openNew(): void {
    this.editing.set(null);
    this.prefill.set(null);
    this.dialogOpen.set(true);
  }

  openEdit(connection: Connection): void {
    this.editing.set(connection);
    this.prefill.set(null);
    this.dialogOpen.set(true);
  }

  /** A Docker database the person picked: a new connection, or the saved one for editing. */
  fromDocker(item: DockerDatabase): void {
    const saved = this.data.find(item.savedConnectionId);
    if (saved) {
      this.openEdit(saved);
      return;
    }
    this.editing.set(null);
    this.prefill.set({
      pluginId: item.pluginId,
      name: item.name,
      config: item.config,
      dockerName: item.containerName,
    });
    this.dialogOpen.set(true);
  }

  openExport(): void {
    this.exportOpen.set(true);
  }

  openImport(): void {
    this.importOpen.set(true);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
  }

  askDelete(connection: Connection): void {
    this.deleting.set(connection);
  }

  cancelDelete(): void {
    this.deleting.set(null);
  }

  async confirmDelete(): Promise<void> {
    const connection = this.deleting();
    if (!connection) return;
    this.deleting.set(null);
    try {
      await this.data.remove(connection.id);
    } catch {
      // Reported by the ActionRunner.
    }
  }
}
