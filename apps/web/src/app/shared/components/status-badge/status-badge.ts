import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadge } from '@mirrorbase/ui/badge';
import type { DatabaseStatus, RunStatus } from '../../../core/api/api.types';

type Tone = 'neutral' | 'active' | 'ok' | 'bad';

const TONES: Readonly<Record<RunStatus | DatabaseStatus, Tone>> = {
  queued: 'neutral',
  pending: 'neutral',
  cancelled: 'neutral',
  running: 'active',
  dumping: 'active',
  restoring: 'active',
  succeeded: 'ok',
  done: 'ok',
  failed: 'bad',
};

/**
 * A run's or a database's status as a badge. Colour is never the only signal: the status is
 * always written out, and the active states carry a spinner dot.
 */
@Component({
  selector: 'mb-status-badge',
  imports: [HlmBadge, TranslatePipe],
  template: `
    <span hlmBadge variant="outline" [class]="toneClass()">
      @if (tone() === 'active') {
        <span class="mb-spinner" aria-hidden="true"></span>
      }
      {{ labelKey() | translate }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  readonly status = input.required<RunStatus | DatabaseStatus>();
  /** Run statuses and database statuses have their own wording ("succeeded" vs. "done"). */
  readonly kind = input<'run' | 'database'>('run');

  protected readonly tone = computed(() => TONES[this.status()]);
  protected readonly toneClass = computed(
    () => `mb-status mb-status-${this.tone()}`,
  );
  protected readonly labelKey = computed(() =>
    this.kind() === 'run'
      ? `runs.status.${this.status()}`
      : `runs.dbStatus.${this.status()}`,
  );
}
