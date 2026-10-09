import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiErrorCode } from '../../../../core/api/api-error';
import {
  type Connection,
  type DockerDatabase,
  isActiveRun,
  type Plugin,
  type Run,
  type TransferPlan,
} from '../../../../core/api/api.types';
import { ConnectionsService } from '../../../../core/connections/connections.service';
import { PluginsService } from '../../../../core/plugins/plugins.service';
import { RunsService } from '../../../../core/runs/runs.service';
import type { ConnectionPrefill } from '../../../../shared/components/connection-dialog';

export type Side = 'source' | 'target';

/** One database found on the source: whether to copy it and what it is called on the target. */
export interface DatabaseChoice {
  readonly name: string;
  readonly selected: boolean;
  readonly target: string;
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

const POLL_MS = 1000;

/**
 * The Replicate page: pick a source and a target connection, load the source's databases, choose
 * which to copy (and under which name), start - then follow the run until it ends. Which database
 * TYPE either side is does not matter here: the API pairs the two plugins.
 */
@Injectable({ providedIn: 'root' })
export class ReplicatePageService {
  readonly data = inject(ConnectionsService);
  private readonly plugins = inject(PluginsService);
  private readonly runs = inject(RunsService);
  private readonly runner = inject(ActionRunner);

  readonly sourceId = signal('');
  readonly targetId = signal('');
  readonly source = computed(() => this.data.find(this.sourceId()));
  readonly target = computed(() => this.data.find(this.targetId()));
  readonly sourcePlugin = computed(() => this.pluginOf(this.source()));
  readonly targetPlugin = computed(() => this.pluginOf(this.target()));

  readonly sources = computed(() =>
    this.data
      .connections()
      .filter(
        (c) =>
          this.plugins.find(c.pluginId)?.capabilities.canBeSource !== false,
      ),
  );
  readonly targets = computed(() =>
    this.data
      .connections()
      .filter(
        (c) =>
          this.plugins.find(c.pluginId)?.capabilities.canBeTarget !== false,
      ),
  );

  readonly loadState = signal<LoadState>('idle');
  readonly loadErrorCode = signal<string | null>(null);
  readonly databases = signal<readonly DatabaseChoice[]>([]);
  readonly replaceExisting = signal(false);
  readonly plan = signal<TransferPlan | null>(null);
  readonly confirmOpen = signal(false);

  /** The run being followed: the one in progress, or the one that just ended. */
  readonly run = signal<Run | null>(null);
  readonly starting = signal(false);

  // Dialogs opened from this page.
  readonly dialogSide = signal<Side | null>(null);
  readonly dockerSide = signal<Side | null>(null);
  readonly prefill = signal<ConnectionPrefill | null>(null);

  readonly selection = computed(() =>
    this.databases().filter((d) => d.selected),
  );
  readonly allSelected = computed(
    () =>
      this.databases().length > 0 && this.databases().every((d) => d.selected),
  );
  /** The target name is only asked for when the target holds several databases. */
  readonly namesMatter = computed(
    () => this.targetPlugin()?.capabilities.multipleDatabases === true,
  );
  readonly sourceIsMulti = computed(
    () => this.sourcePlugin()?.capabilities.multipleDatabases === true,
  );
  readonly runActive = computed(() => {
    const run = this.run();
    return run !== null && isActiveRun(run.status);
  });
  readonly planBlocked = computed(() => this.plan()?.kind === 'unsupported');

  /** Why Start is disabled, as an i18n key - or null when it can start. */
  readonly blocker = computed<string | null>(() => {
    if (this.runActive()) return 'replicate.blocker.running';
    if (!this.source() || !this.target()) return 'replicate.blocker.pickBoth';
    if (this.planBlocked()) return 'replicate.blocker.unsupported';
    if (this.loadState() !== 'ready') return 'replicate.blocker.noDatabases';
    const chosen = this.selection();
    if (chosen.length === 0) return 'replicate.blocker.selectOne';
    if (chosen.some((d) => d.target.trim() === ''))
      return 'replicate.blocker.emptyName';
    if (new Set(chosen.map((d) => d.target.trim())).size !== chosen.length) {
      return 'replicate.blocker.duplicateName';
    }
    return null;
  });
  readonly canStart = computed(
    () => this.blocker() === null && !this.starting(),
  );

  private timer: ReturnType<typeof setInterval> | undefined;
  private loadGeneration = 0;

  constructor() {
    // A new source: its databases.
    effect(() => {
      const id = this.sourceId();
      const known = this.source();
      untracked(() => {
        if (id && known) void this.loadDatabases();
        else this.clearDatabases();
      });
    });
    // Both sides: how the data would travel.
    effect(() => {
      const source = this.source();
      const target = this.target();
      untracked(() => void this.refreshPlan(source, target));
    });
    void this.resume();
  }

  private pluginOf(connection: Connection | undefined): Plugin | undefined {
    return connection ? this.plugins.find(connection.pluginId) : undefined;
  }

  // --- choosing ---

  choose(side: Side, id: string): void {
    (side === 'source' ? this.sourceId : this.targetId).set(id);
  }

  openNewConnection(side: Side): void {
    this.prefill.set(null);
    this.dialogSide.set(side);
  }

  openDocker(side: Side): void {
    this.data.reloadDocker();
    this.dockerSide.set(side);
  }

  /** A Docker database picked for `side`: select the saved connection, or create one. */
  pickedFromDocker(item: DockerDatabase): void {
    const side = this.dockerSide();
    this.dockerSide.set(null);
    if (!side) return;
    const saved = this.data.find(item.savedConnectionId);
    if (saved) {
      this.choose(side, saved.id);
      return;
    }
    this.prefill.set({
      pluginId: item.pluginId,
      name: item.name,
      config: item.config,
      dockerName: item.containerName,
    });
    this.dialogSide.set(side);
  }

  closeDialog(): void {
    this.dialogSide.set(null);
  }

  /** A connection was created here: use it for the side it was created for. */
  savedHere(connection: Connection): void {
    const side = this.dialogSide();
    this.dialogSide.set(null);
    if (side) this.choose(side, connection.id);
  }

  // --- databases ---

  async loadDatabases(): Promise<void> {
    const id = this.sourceId();
    if (!id) return;
    const generation = ++this.loadGeneration;
    this.loadState.set('loading');
    this.loadErrorCode.set(null);
    this.databases.set([]);
    try {
      const names = await this.data.databases(id);
      if (generation !== this.loadGeneration) return;
      const single = !this.sourceIsMulti();
      this.databases.set(
        names.map((name) => ({ name, selected: single, target: name })),
      );
      this.loadState.set('ready');
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.loadErrorCode.set(apiErrorCode(error) ?? 'unknown');
      this.loadState.set('failed');
    }
  }

  private clearDatabases(): void {
    this.loadGeneration++;
    this.databases.set([]);
    this.loadState.set('idle');
    this.loadErrorCode.set(null);
  }

  toggle(name: string): void {
    this.databases.update((list) =>
      list.map((d) => (d.name === name ? { ...d, selected: !d.selected } : d)),
    );
  }

  toggleAll(): void {
    const select = !this.allSelected();
    this.databases.update((list) =>
      list.map((d) => ({ ...d, selected: select })),
    );
  }

  rename(name: string, target: string): void {
    this.databases.update((list) =>
      list.map((d) => (d.name === name ? { ...d, target } : d)),
    );
  }

  private async refreshPlan(
    source: Connection | undefined,
    target: Connection | undefined,
  ): Promise<void> {
    if (!source || !target) {
      this.plan.set(null);
      return;
    }
    try {
      this.plan.set(await this.plugins.plan(source.pluginId, target.pluginId));
    } catch {
      this.plan.set(null);
    }
  }

  // --- running ---

  private readonly startAction = defineAction<void, Run>({
    run: () => {
      const body = {
        sourceId: this.sourceId(),
        targetId: this.targetId(),
        databases: this.selection().map((d) => ({
          source: d.name,
          target: this.namesMatter() ? d.target.trim() : d.name,
        })),
        replaceExisting: this.replaceExisting(),
      };
      return this.runs.start(body);
    },
    messages: { error: 'replicate.startFailed' },
  });

  private readonly cancelAction = defineAction<string, Run>({
    run: (id) => this.runs.cancel(id),
    messages: { error: 'replicate.cancelFailed' },
  });

  /** Start, after asking when it would replace databases. */
  requestStart(): void {
    if (!this.canStart()) return;
    if (this.replaceExisting()) this.confirmOpen.set(true);
    else void this.start();
  }

  cancelConfirm(): void {
    this.confirmOpen.set(false);
  }

  async start(): Promise<void> {
    this.confirmOpen.set(false);
    if (!this.canStart()) return;
    this.starting.set(true);
    try {
      this.track(
        await this.runner.run(this.startAction, undefined, { key: 'start' }),
      );
    } catch {
      // Told by the ActionRunner.
    } finally {
      this.starting.set(false);
    }
  }

  async cancelRun(): Promise<void> {
    const run = this.run();
    if (!run) return;
    try {
      await this.runner.run(this.cancelAction, run.id, { key: 'cancel' });
    } catch {
      // Told by the ActionRunner.
    }
  }

  dismissRun(): void {
    if (!this.runActive()) this.run.set(null);
  }

  /** A run may already be in progress (the window was closed and reopened). */
  private async resume(): Promise<void> {
    try {
      const [latest] = await this.runs.list(1);
      if (latest && isActiveRun(latest.status)) this.track(latest);
    } catch {
      // Nothing to resume.
    }
  }

  /** Follows a run until it ends. */
  private track(run: Run): void {
    this.run.set(run);
    this.stopTimer();
    if (!isActiveRun(run.status)) return;
    this.timer = setInterval(async () => {
      try {
        const fresh = await this.runs.get(run.id);
        this.run.set(fresh);
        if (!isActiveRun(fresh.status)) {
          this.stopTimer();
          this.data.reload(); // "last used" changed
        }
      } catch {
        // Keep trying; a locked app waits in the interceptor.
      }
    }, POLL_MS);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** For tests: stop polling. */
  dispose(): void {
    this.stopTimer();
  }
}
