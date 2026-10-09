import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@dbreplicator/ui/button';
import { HlmInputImports } from '@dbreplicator/ui/input';
import {
  LOG_LEVELS,
  type LogEntry,
  type LogLevel,
} from '../../../core/api/api.types';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RunsService } from '../../../core/runs/runs.service';
import { formatClock } from '../../format/format';

/** Most entries kept in the viewer; older ones scroll away (the full log stays on disk). */
const KEEP = 2000;
const POLL_MS = 1500;
const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * The log of one run - or, without a run, the app's own log. While `live` it polls for new
 * lines every 1.5 s and follows the end unless the person scrolled up to read.
 */
@Component({
  selector: 'dr-log-viewer',
  imports: [NgIcon, TranslatePipe, ...HlmButtonImports, ...HlmInputImports],
  providers: [provideIcons({ lucideCopy })],
  templateUrl: './log-viewer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogViewer {
  private readonly runs = inject(RunsService);
  private readonly notifications = inject(NotificationService);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  /** The run whose log to show; null = the app's own entries. */
  readonly runId = input<string | null>(null);
  /** Keep polling for new lines (a run in progress, the app log). */
  readonly live = input(false);

  protected readonly levels = LOG_LEVELS;
  protected readonly minLevel = signal<LogLevel>('info');
  protected readonly entries = signal<readonly LogEntry[]>([]);
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
  protected readonly visible = computed(() =>
    this.entries().filter(
      (entry) => LEVEL_RANK[entry.level] >= LEVEL_RANK[this.minLevel()],
    ),
  );

  private lastId = 0;
  private following = true;
  private generation = 0;

  constructor() {
    // A different run (or the app log) starts from scratch.
    effect(() => {
      const runId = this.runId();
      untracked(() => void this.reset(runId));
    });
    // Polling while live.
    effect((onCleanup) => {
      if (!this.live()) return;
      const timer = setInterval(() => void this.poll(), POLL_MS);
      onCleanup(() => clearInterval(timer));
    });
    inject(DestroyRef).onDestroy(() => (this.generation = -1));
  }

  protected clock(entry: LogEntry): string {
    return formatClock(entry.at);
  }

  protected onScroll(): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    this.following = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  protected setLevel(value: string): void {
    if ((LOG_LEVELS as readonly string[]).includes(value))
      this.minLevel.set(value as LogLevel);
    this.scrollToEnd();
  }

  protected async copy(): Promise<void> {
    const text = this.visible()
      .map(
        (entry) =>
          `${entry.at} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.notifications.success('log.copied');
    } catch {
      this.notifications.error('log.copyFailed');
    }
  }

  private async reset(runId: string | null): Promise<void> {
    const generation = ++this.generation;
    this.entries.set([]);
    this.loaded.set(false);
    this.failed.set(false);
    this.lastId = 0;
    this.following = true;
    try {
      const newestFirst = await this.runs.log({
        ...(runId ? { runId } : { appOnly: true }),
        limit: 500,
      });
      if (generation !== this.generation) return;
      const oldestFirst = [...newestFirst].reverse();
      this.entries.set(oldestFirst);
      this.lastId = oldestFirst.at(-1)?.id ?? 0;
      this.loaded.set(true);
      this.scrollToEnd();
    } catch {
      if (generation === this.generation) {
        this.failed.set(true);
        this.loaded.set(true);
      }
    }
  }

  private async poll(): Promise<void> {
    const generation = this.generation;
    const runId = this.runId();
    try {
      const fresh = await this.runs.log({
        ...(runId ? { runId } : { appOnly: true }),
        afterId: this.lastId,
        limit: 500,
      });
      if (generation !== this.generation || fresh.length === 0) return;
      this.lastId = fresh.at(-1)?.id ?? this.lastId;
      this.entries.update((current) => [...current, ...fresh].slice(-KEEP));
      this.scrollToEnd();
    } catch {
      // The next tick tries again; a locked app waits in the interceptor.
    }
  }

  private scrollToEnd(): void {
    if (!this.following) return;
    queueMicrotask(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
