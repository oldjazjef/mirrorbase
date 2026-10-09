/** UI text a plugin ships itself: English is required, other languages optional (fallback `en`). */
export interface LocalizedText {
  readonly en: string;
  readonly 'de-CH'?: string;
}

/** The text in `locale`, falling back to English. */
export function localized(text: LocalizedText, locale: string): string {
  return (locale === 'de-CH' ? text['de-CH'] : undefined) ?? text.en;
}
