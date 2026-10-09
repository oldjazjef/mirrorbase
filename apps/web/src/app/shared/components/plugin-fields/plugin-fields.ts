import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@dbreplicator/ui/button';
import { HlmInputImports } from '@dbreplicator/ui/input';
import { HlmLabelImports } from '@dbreplicator/ui/label';
import type { FieldDescriptor } from '../../../core/api/api.types';
import { LocalizedPipe } from '../../plugins/localized.pipe';
import { placeholderOf } from '../../plugins/plugin-schema';

/**
 * Draws the connection settings a database plugin declares. The component knows field TYPES
 * (text, number, password, path, select, boolean), never a database - so a new plugin shows up
 * here without touching the web app. Validation lives in the form's Zod validator.
 */
@Component({
  selector: 'dr-plugin-fields',
  imports: [
    NgTemplateOutlet,
    NgIcon,
    ReactiveFormsModule,
    TranslatePipe,
    LocalizedPipe,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [provideIcons({ lucideChevronRight })],
  templateUrl: './plugin-fields.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginFields {
  readonly fields = input.required<readonly FieldDescriptor[]>();
  readonly form = input.required<FormGroup>();
  /** Password fields that already have a saved value. */
  readonly savedSecrets = input<readonly string[]>([]);
  /** Saved passwords the person chose to forget. */
  readonly forgotten = input<readonly string[]>([]);
  readonly forget = output<string>();

  protected readonly advancedOpen = signal(false);
  protected readonly basic = computed(() =>
    this.fields().filter((f) => !f.advanced),
  );
  protected readonly advanced = computed(() =>
    this.fields().filter((f) => f.advanced),
  );

  protected placeholder(field: FieldDescriptor): string | undefined {
    if (field.secret && this.isSaved(field.key)) return undefined;
    return placeholderOf(field);
  }

  protected isSaved(key: string): boolean {
    return this.savedSecrets().includes(key) && !this.forgotten().includes(key);
  }

  protected error(key: string): string | null {
    const control = this.form().get(key);
    return control?.touched || control?.dirty
      ? ((control.errors?.['zod'] as string | undefined) ?? null)
      : null;
  }

  protected wide(field: FieldDescriptor): boolean {
    return field.type === 'path' || field.type === 'boolean';
  }

  protected toggleAdvanced(): void {
    this.advancedOpen.update((open) => !open);
  }
}
