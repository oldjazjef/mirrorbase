import { Pipe, type PipeTransform, inject } from '@angular/core';
import type { LocalizedText } from '../../core/api/api.types';
import { LanguageService } from '../../core/i18n/language.service';

/**
 * `{{ field.label | drLocalized }}` - the text a database plugin ships in the app's language,
 * English when the plugin has no translation. Impure: it follows a language switch.
 */
@Pipe({ name: 'drLocalized', pure: false })
export class LocalizedPipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(text: LocalizedText | undefined | null): string {
    if (!text) return '';
    return (
      (this.language.current() === 'de-CH' ? text['de-CH'] : undefined) ??
      text.en
    );
  }
}
