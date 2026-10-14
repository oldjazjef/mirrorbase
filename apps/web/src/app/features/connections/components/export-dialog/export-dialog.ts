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
import { ConnectionsService } from '../../../../core/connections/connections.service';
import { NotificationService } from '../../../../core/notifications/notification.service';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Exports the saved connections to a file. Saved passwords only go into the file together with
 * an export password, which encrypts the whole file - so ticking "include passwords" switches
 * the encryption on and keeps it on.
 */
@Component({
  selector: 'mb-export-dialog',
  imports: [
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  templateUrl: './export-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportDialog {
  private readonly connections = inject(ConnectionsService);
  private readonly notifications = inject(NotificationService);

  readonly open = input(false);
  readonly closed = output<void>();

  protected readonly formId = 'mb-export-form';
  protected readonly includePasswords = signal(false);
  protected readonly encrypt = signal(false);
  protected readonly password = signal('');
  protected readonly repeat = signal('');
  protected readonly busy = signal(false);

  protected readonly state = computed<'open' | 'closed'>(() =>
    this.open() ? 'open' : 'closed',
  );
  protected readonly encrypting = computed(
    () => this.encrypt() || this.includePasswords(),
  );
  protected readonly tooShort = computed(
    () =>
      this.encrypting() &&
      this.password().length > 0 &&
      this.password().length < MIN_PASSWORD_LENGTH,
  );
  protected readonly mismatch = computed(
    () => this.repeat().length > 0 && this.password() !== this.repeat(),
  );
  protected readonly valid = computed(
    () =>
      !this.encrypting() ||
      (this.password().length >= MIN_PASSWORD_LENGTH &&
        this.password() === this.repeat()),
  );

  constructor() {
    // A fresh form each time the dialog opens; a typed password must not linger.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.includePasswords.set(false);
        this.encrypt.set(false);
        this.password.set('');
        this.repeat.set('');
      });
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected async export(): Promise<void> {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    try {
      const file = await this.connections.export({
        includePasswords: this.includePasswords(),
        ...(this.encrypting() ? { password: this.password() } : {}),
      });
      download(
        `mirrorbase-connections-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(file, null, 2),
      );
      this.notifications.success('connections.export.done');
      this.closed.emit();
    } catch (error) {
      this.notifications.error(
        'connections.export.failed',
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

function download(name: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
