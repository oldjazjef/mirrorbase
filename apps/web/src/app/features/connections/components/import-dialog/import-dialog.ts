import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@mirrorbase/ui/button';
import { HlmDialogImports } from '@mirrorbase/ui/dialog';
import { HlmInputImports } from '@mirrorbase/ui/input';
import { HlmLabelImports } from '@mirrorbase/ui/label';
import { apiErrorText } from '../../../../core/api/api-error';
import type { ImportResult } from '../../../../core/api/api.types';
import { ConnectionsService } from '../../../../core/connections/connections.service';
import { NotificationService } from '../../../../core/notifications/notification.service';

/** Reads an export file and imports its connections; asks for the password of an encrypted one. */
@Component({
  selector: 'mb-import-dialog',
  imports: [
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  templateUrl: './import-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportDialog {
  private readonly connections = inject(ConnectionsService);
  private readonly notifications = inject(NotificationService);

  readonly open = input(false);
  readonly closed = output<void>();

  protected readonly formId = 'mb-import-form';
  protected readonly fileName = signal('');
  protected readonly content = signal('');
  protected readonly encrypted = signal(false);
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly result = signal<ImportResult | null>(null);

  protected readonly state = computed<'open' | 'closed'>(() =>
    this.open() ? 'open' : 'closed',
  );
  protected readonly ready = computed(
    () =>
      this.content().length > 0 &&
      (!this.encrypted() || this.password().length > 0),
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.fileName.set('');
        this.content.set('');
        this.encrypted.set(false);
        this.password.set('');
        this.result.set(null);
      });
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async chooseFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.result.set(null);
    if (!file) {
      this.fileName.set('');
      this.content.set('');
      this.encrypted.set(false);
      return;
    }
    const text = await file.text();
    this.fileName.set(file.name);
    this.content.set(text);
    this.encrypted.set(isEncrypted(text));
  }

  protected async import(): Promise<void> {
    if (!this.ready() || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.connections.import({
        content: this.content(),
        ...(this.encrypted() ? { password: this.password() } : {}),
      });
      this.result.set(result);
    } catch (error) {
      this.notifications.error(
        'connections.import.failed',
        apiErrorText(error),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected onStateChanged(state: 'open' | 'closed'): void {
    if (state === 'closed' && this.open()) this.closed.emit();
  }
}

function isEncrypted(text: string): boolean {
  try {
    return (JSON.parse(text) as { encrypted?: unknown }).encrypted === true;
  } catch {
    return false;
  }
}
