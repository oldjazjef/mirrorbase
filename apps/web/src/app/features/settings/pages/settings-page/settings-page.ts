import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFolderOpen, lucideLock } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@dbreplicator/ui/button';
import { HlmInputImports } from '@dbreplicator/ui/input';
import { HlmLabelImports } from '@dbreplicator/ui/label';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '../../../../core/i18n/locales';
import { PageHeader } from '../../../../shared/components/page-header';
import {
  AUTO_LOCK_CHOICES,
  SettingsPageService,
} from './settings-page.service';

@Component({
  selector: 'dr-settings-page',
  imports: [
    NgIcon,
    ReactiveFormsModule,
    TranslatePipe,
    PageHeader,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [provideIcons({ lucideFolderOpen, lucideLock })],
  templateUrl: './settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  protected readonly service = inject(SettingsPageService);
  protected readonly autoLockChoices = AUTO_LOCK_CHOICES;
  protected readonly locales = SUPPORTED_LOCALES;
  protected readonly localeNames = LOCALE_NAMES;

  protected error(field: 'currentPin' | 'pin' | 'repeat'): string | null {
    const control = this.service.form.controls[field];
    return control.touched
      ? ((control.errors?.['zod'] as string | undefined) ?? null)
      : null;
  }
}
