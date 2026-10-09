/**
 * Locales the app ships. Adding one means adding `public/i18n/<code>.json` (every key of
 * en.json - `i18n-keys.spec.ts` checks), the code here, and its Angular locale data
 * (`i18n.config.ts`). Database plugins ship their own texts for fields and carry their own
 * languages, English being required and the fallback.
 */
export const SUPPORTED_LOCALES = ['en', 'de-CH'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** How each language is called in its own language (the select shows these). */
export const LOCALE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  'de-CH': 'Deutsch (Schweiz)',
  en: 'English',
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/** The browser's language - German (any de-*) → de-CH, everything else English. */
export function browserLocale(
  languages: readonly string[] = typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
): SupportedLocale {
  const first = languages.find((language) => !!language) ?? DEFAULT_LOCALE;
  return first.toLowerCase().startsWith('de') ? 'de-CH' : 'en';
}

/** Where the last used language is kept on this device. */
// A template literal: i18n-keys.spec.ts reads quoted dotted literals as translation keys.
export const LOCALE_STORAGE_KEY = `mb.locale`;

/** The language at start: the one used last on this device, else the browser's. */
export function initialLocale(): SupportedLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(stored)) return stored;
  } catch {
    // Storage blocked: the browser's language.
  }
  return browserLocale();
}
