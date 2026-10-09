/**
 * Texts of the native dialogs the main process shows: the web app is translated with
 * ngx-translate; these few open before or outside it. One dictionary per language - the app's
 * language from the desktop config (set by the window when it changes), else the system's.
 * Pure: unit-tested without Electron.
 */
export const DESKTOP_LOCALES = ['en', 'de-CH'] as const;
export type DesktopLocale = (typeof DESKTOP_LOCALES)[number];

export function isDesktopLocale(value: unknown): value is DesktopLocale {
  return (
    typeof value === 'string' &&
    (DESKTOP_LOCALES as readonly string[]).includes(value)
  );
}

/** The system's language (`app.getLocale()`, e.g. `de-CH`, `en-US`) → de-CH for any German. */
export function systemLocale(locale: string | undefined): DesktopLocale {
  return (locale ?? '').toLowerCase().startsWith('de') ? 'de-CH' : 'en';
}

export interface DesktopMessages {
  readonly fatal: {
    readonly title: string;
    readonly detail: (reason: string) => string;
  };
  readonly about: {
    readonly credits: string;
  };
}

const MESSAGES: Record<DesktopLocale, DesktopMessages> = {
  en: {
    fatal: {
      title: 'DB Replicator could not start',
      detail: (reason) =>
        `The app could not start.\n\n${reason}\n\nThe details are in the log file in the app's data folder.`,
    },
    about: {
      credits:
        'Copies databases between servers. Passwords are stored encrypted.',
    },
  },
  'de-CH': {
    fatal: {
      title: 'DB Replicator konnte nicht gestartet werden',
      detail: (reason) =>
        `Die App konnte nicht gestartet werden.\n\n${reason}\n\nDie Einzelheiten stehen in der Protokolldatei im Datenordner der App.`,
    },
    about: {
      credits:
        'Kopiert Datenbanken zwischen Servern. Passwörter werden verschlüsselt gespeichert.',
    },
  },
};

export function desktopMessages(locale: DesktopLocale): DesktopMessages {
  return MESSAGES[locale];
}
