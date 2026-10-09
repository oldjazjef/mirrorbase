/**
 * The desktop shell's API (`window.mirrorbaseDesktop`, exposed by apps/desktop's preload
 * script). Absent in the browser. A mirror of `apps/desktop/src/shared/bridge.ts` - keep both in
 * step; the web app must not import from apps/desktop.
 */
export interface StorageInfo {
  dataDir: string;
  databaseFile: string;
  appVersion: string;
  /** How the password key is protected: the OS keychain, or only a file with owner permissions. */
  keyProtection: 'os-keychain' | 'file';
}

export interface DesktopBridge {
  readonly platform: string;
  readonly storage: {
    info(): Promise<StorageInfo>;
    reveal(): Promise<void>;
  };
  /** The shell locks the app on OS lock / suspend / system idle. */
  readonly lock?: {
    onLocked(listener: (reason: string) => void): () => void;
    setIdleMinutes(minutes: number): Promise<void>;
  };
  /** The app's language for the shell's menus and dialogs. */
  readonly locale?: {
    set(locale: string): Promise<void>;
  };
}

declare global {
  interface Window {
    mirrorbaseDesktop?: DesktopBridge;
  }
}

/** The bridge when running inside the desktop app, otherwise null. */
export function desktopBridge(): DesktopBridge | null {
  return window.mirrorbaseDesktop ?? null;
}
