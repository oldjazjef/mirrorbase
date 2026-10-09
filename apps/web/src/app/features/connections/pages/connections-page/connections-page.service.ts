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

export interface ConnectionRow {
  readonly connection: Connection;
  readonly pluginName: string;
  readonly target: string;
  readonly hasPassword: boolean;
}

/** UI state of the Connections page; the data itself comes from the shared ConnectionsService. */
@Injectable({ providedIn: 'root' })
export class ConnectionsPageService {
  readonly data = inject(ConnectionsService);
  private readonly plugins = inject(PluginsService);

  readonly dialogOpen = signal(false);
  readonly editing = signal<Connection | null>(null);
  readonly prefill = signal<ConnectionPrefill | null>(null);
  readonly deleting = signal<Connection | null>(null);

  readonly rows = computed<readonly ConnectionRow[]>(() =>
    this.data.connections().map((connection) => ({
      connection,
      pluginName:
        this.plugins.find(connection.pluginId)?.name ?? connection.pluginId,
      target: summarizeConfig(connection.config),
      hasPassword: connection.secretKeys.length > 0,
    })),
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
