import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBox,
  lucidePencil,
  lucidePlus,
  lucideTrash2,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadge } from '@dbreplicator/ui/badge';
import { HlmButtonImports } from '@dbreplicator/ui/button';
import { HlmDialogImports } from '@dbreplicator/ui/dialog';
import { HlmSkeletonImports } from '@dbreplicator/ui/skeleton';
import { HlmTableImports } from '@dbreplicator/ui/table';
import { LanguageService } from '../../../../core/i18n/language.service';
import { ConnectionDialog } from '../../../../shared/components/connection-dialog';
import { EmptyState } from '../../../../shared/components/empty-state';
import { PageHeader } from '../../../../shared/components/page-header';
import {
  type RowAction,
  RowActions,
} from '../../../../shared/components/row-actions';
import { Truncate } from '../../../../shared/components/truncate';
import {
  ConnectionsPageService,
  type ConnectionRow,
} from './connections-page.service';

type RowActionId = 'edit' | 'delete';

@Component({
  selector: 'dr-connections-page',
  imports: [
    DatePipe,
    NgIcon,
    HlmBadge,
    TranslatePipe,
    ConnectionDialog,
    EmptyState,
    PageHeader,
    RowActions,
    Truncate,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmSkeletonImports,
    ...HlmTableImports,
  ],
  providers: [
    provideIcons({ lucideBox, lucidePencil, lucidePlus, lucideTrash2 }),
  ],
  templateUrl: './connections-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionsPage {
  protected readonly service = inject(ConnectionsPageService);
  protected readonly language = inject(LanguageService);
  protected readonly skeletonRows = [1, 2, 3];

  protected readonly actions: readonly RowAction<RowActionId>[] = [
    { id: 'edit', labelKey: 'common.edit', icon: lucidePencil },
    {
      id: 'delete',
      labelKey: 'common.delete',
      icon: lucideTrash2,
      danger: true,
    },
  ];

  protected readonly deleteState = computed<'open' | 'closed'>(() =>
    this.service.deleting() ? 'open' : 'closed',
  );

  constructor() {
    // The list may have changed elsewhere (a connection added on the Replicate page).
    this.service.data.reload();
  }

  protected act(id: string, row: ConnectionRow): void {
    if (id === 'edit') this.service.openEdit(row.connection);
    else if (id === 'delete') this.service.askDelete(row.connection);
  }

  protected onDeleteStateChanged(state: 'open' | 'closed'): void {
    if (state === 'closed') this.service.cancelDelete();
  }
}
