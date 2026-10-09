import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowRight, lucideX } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@mirrorbase/ui/button';
import { isActiveRun, type Run } from '../../../core/api/api.types';
import { LanguageService } from '../../../core/i18n/language.service';
import { formatBytes, formatDuration } from '../../format/format';
import { StatusBadge } from '../status-badge';
import { Truncate } from '../truncate';

/**
 * One run: where it copies from and to, its status, and for every database how far it got. The
 * same component shows a run that is in progress and one from the history.
 */
@Component({
  selector: 'mb-run-progress',
  imports: [
    DatePipe,
    NgIcon,
    TranslatePipe,
    StatusBadge,
    Truncate,
    ...HlmButtonImports,
  ],
  providers: [provideIcons({ lucideArrowRight, lucideX })],
  templateUrl: './run-progress.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunProgress {
  protected readonly language = inject(LanguageService);

  readonly run = input.required<Run>();
  /** Offer "Cancel" while the run is in progress. */
  readonly cancellable = input(true);
  readonly cancelRequested = output<void>();

  protected readonly active = computed(() => isActiveRun(this.run().status));
  protected readonly duration = computed(() =>
    formatDuration(this.run().startedAt, this.run().finishedAt),
  );
  protected readonly counts = computed(() => {
    const databases = this.run().databases;
    return {
      done: databases.filter((d) => d.status === 'done').length,
      total: databases.length,
    };
  });

  protected readonly bytes = formatBytes;

  protected errorKey(code: string | null): string | null {
    return code ? `errors.api.${code}` : null;
  }
}
