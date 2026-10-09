import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import { HELP_FAQ, HELP_SECTIONS, type HelpSection } from '../../help-content';

export interface NumberedSection extends HelpSection {
  readonly number: number;
}

/** Lower case, accents removed, so «Pruefung» style searches are forgiving. */
export function normalise(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every word of `query` appears in `text`. */
export function matches(text: string, query: string): boolean {
  const haystack = normalise(text);
  return normalise(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The guide's state: the search text and what it leaves visible. */
@Injectable()
export class HelpPageService {
  private readonly translate = inject(TranslateService);
  private readonly language = toSignal(
    this.translate.onLangChange.pipe(startWith(null)),
  );

  readonly query = signal('');
  readonly total = HELP_SECTIONS.length;

  readonly searching = computed(() => this.query().trim() !== '');

  private text(key: string): string {
    this.language();
    return this.translate.instant(key) as string;
  }

  readonly sections = computed<NumberedSection[]>(() =>
    HELP_SECTIONS.map((section, index) => ({
      ...section,
      number: index + 1,
    })),
  );

  readonly visibleSections = computed<NumberedSection[]>(() => {
    const query = this.query().trim();
    if (!query) return this.sections();
    return this.sections().filter((section) => {
      const keys = [
        `help.sections.${section.id}.title`,
        `help.sections.${section.id}.purpose`,
        ...section.steps.map((s) => `help.sections.${section.id}.steps.${s}`),
        ...section.tips.map((t) => `help.sections.${section.id}.tips.${t}`),
      ];
      return matches(keys.map((key) => this.text(key)).join(' '), query);
    });
  });

  readonly visibleFaq = computed<string[]>(() => {
    const query = this.query().trim();
    if (!query) return [...HELP_FAQ];
    return HELP_FAQ.filter((id) =>
      matches(
        `${this.text(`help.faq.items.${id}.question`)} ${this.text(`help.faq.items.${id}.answer`)}`,
        query,
      ),
    );
  });

  readonly nothingFound = computed(
    () =>
      this.searching() &&
      this.visibleSections().length === 0 &&
      this.visibleFaq().length === 0,
  );
}
