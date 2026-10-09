import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBox, lucideRefreshCw } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadge } from '@mirrorbase/ui/badge';
import { HlmButtonImports } from '@mirrorbase/ui/button';
import { HlmDialogImports } from '@mirrorbase/ui/dialog';
import { HlmSkeletonImports } from '@mirrorbase/ui/skeleton';
import type { DockerDatabase } from '../../../core/api/api.types';
import { ConnectionsService } from '../../../core/connections/connections.service';
import { Truncate } from '../truncate';

/**
 * The databases running in Docker containers on this computer, as every installed plugin
 * recognises them. Picking one hands it back; the caller turns it into a saved connection (the
 * password is never read from the container) or selects the connection that already exists.
 */
@Component({
  selector: 'mb-docker-picker',
  imports: [
    NgIcon,
    HlmBadge,
    TranslatePipe,
    Truncate,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmSkeletonImports,
  ],
  providers: [provideIcons({ lucideBox, lucideRefreshCw })],
  templateUrl: './docker-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockerPicker {
  protected readonly connections = inject(ConnectionsService);

  readonly open = input(false);
  /** Only offer databases of this plugin capability (source/target), when set. */
  readonly closed = output<void>();
  readonly picked = output<DockerDatabase>();

  protected readonly state = computed<'open' | 'closed'>(() =>
    this.open() ? 'open' : 'closed',
  );
  protected readonly result = computed(() =>
    this.connections.docker.hasValue() ? this.connections.docker.value() : null,
  );

  protected nameOf(id: string | null): string {
    return this.connections.find(id)?.name ?? '';
  }

  protected onStateChanged(state: 'open' | 'closed'): void {
    if (state === 'closed' && this.open()) this.closed.emit();
  }

  protected refresh(): void {
    this.connections.reloadDocker();
  }
}
