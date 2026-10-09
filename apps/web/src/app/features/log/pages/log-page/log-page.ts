import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowRight, lucideScrollText } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmSkeletonImports } from '@mirrorbase/ui/skeleton';
import { LanguageService } from '../../../../core/i18n/language.service';
import { EmptyState } from '../../../../shared/components/empty-state';
import { LogViewer } from '../../../../shared/components/log-viewer';
import { PageHeader } from '../../../../shared/components/page-header';
import { RunProgress } from '../../../../shared/components/run-progress';
import { StatusBadge } from '../../../../shared/components/status-badge';
import { Truncate } from '../../../../shared/components/truncate';
import { LogPageService } from './log-page.service';

const REFRESH_MS = 3000;

@Component({
  selector: 'mb-log-page',
  imports: [
    DatePipe,
    RouterLink,
    NgIcon,
    TranslatePipe,
    EmptyState,
    LogViewer,
    PageHeader,
    RunProgress,
    StatusBadge,
    Truncate,
    ...HlmSkeletonImports,
  ],
  providers: [provideIcons({ lucideArrowRight, lucideScrollText })],
  templateUrl: './log-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogPage {
  protected readonly service = inject(LogPageService);
  protected readonly language = inject(LanguageService);

  /** `?run=<id>` selects a run; absent = the app's own log. No default: absent binds undefined. */
  readonly run = input<string>();

  constructor() {
    effect(() => this.service.select(this.run()));
    void this.service.refresh();
    effect((onCleanup) => {
      const timer = setInterval(() => void this.service.refresh(), REFRESH_MS);
      onCleanup(() => clearInterval(timer));
    });
  }
}
