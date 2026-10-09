import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBox,
  lucideCircleAlert,
  lucideLoaderCircle,
  lucidePlay,
  lucidePlus,
  lucideRefreshCw,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadge } from '@mirrorbase/ui/badge';
import { HlmButtonImports } from '@mirrorbase/ui/button';
import { HlmDialogImports } from '@mirrorbase/ui/dialog';
import { HlmInputImports } from '@mirrorbase/ui/input';
import { HlmLabelImports } from '@mirrorbase/ui/label';
import { HlmSkeletonImports } from '@mirrorbase/ui/skeleton';
import type { Connection } from '../../../../core/api/api.types';
import { ConnectionDialog } from '../../../../shared/components/connection-dialog';
import { DockerPicker } from '../../../../shared/components/docker-picker';
import { PageHeader } from '../../../../shared/components/page-header';
import { RunProgress } from '../../../../shared/components/run-progress';
import { Truncate } from '../../../../shared/components/truncate';
import { summarizeConfig } from '../../../../shared/format/format';
import { type Side, ReplicatePageService } from './replicate-page.service';

@Component({
  selector: 'mb-replicate-page',
  imports: [
    RouterLink,
    NgIcon,
    HlmBadge,
    TranslatePipe,
    ConnectionDialog,
    DockerPicker,
    PageHeader,
    RunProgress,
    Truncate,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSkeletonImports,
  ],
  providers: [
    provideIcons({
      lucideBox,
      lucideCircleAlert,
      lucideLoaderCircle,
      lucidePlay,
      lucidePlus,
      lucideRefreshCw,
    }),
  ],
  templateUrl: './replicate-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplicatePage {
  protected readonly service = inject(ReplicatePageService);

  /** The two sides, so the template renders them from one block. */
  protected readonly sides: readonly Side[] = ['source', 'target'];

  protected readonly confirmState = computed<'open' | 'closed'>(() =>
    this.service.confirmOpen() ? 'open' : 'closed',
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private lastRunId: string | null = null;

  constructor() {
    this.service.data.reload();
    // A started run shows its progress below the fold: bring it into view once per run.
    effect(() => {
      const id = this.service.run()?.id ?? null;
      if (id === null || id === this.lastRunId) return;
      this.lastRunId = id;
      queueMicrotask(() =>
        this.host.nativeElement
          .querySelector('mb-run-progress')
          ?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }),
      );
    });
  }

  protected options(side: Side): readonly Connection[] {
    return side === 'source' ? this.service.sources() : this.service.targets();
  }

  protected selected(side: Side): string {
    return side === 'source'
      ? this.service.sourceId()
      : this.service.targetId();
  }

  protected connection(side: Side): Connection | undefined {
    return side === 'source' ? this.service.source() : this.service.target();
  }

  protected pluginName(side: Side): string {
    const plugin =
      side === 'source'
        ? this.service.sourcePlugin()
        : this.service.targetPlugin();
    return plugin?.name ?? '';
  }

  protected summary(connection: Connection): string {
    return summarizeConfig(connection.config);
  }

  protected onConfirmStateChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.service.cancelConfirm();
  }

  protected dockerOpen(): boolean {
    return this.service.dockerSide() !== null;
  }

  protected dialogOpen(): boolean {
    return this.service.dialogSide() !== null;
  }
}
