import {
  type DesktopLocale,
  type DesktopMessages,
  desktopMessages,
} from './lib/messages';

/**
 * The language of the main process's dialogs - the desktop config's `locale` (the app's language,
 * sent by the window), else the system's. Set at start and on every change.
 */
let active: DesktopLocale = 'en';

export function setMessagesLocale(locale: DesktopLocale): void {
  active = locale;
}

export function messages(): DesktopMessages {
  return desktopMessages(active);
}
