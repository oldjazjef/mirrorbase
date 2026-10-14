/**
 * The window's only access to the desktop shell: `window.mirrorbaseDesktop`, exposed by the
 * preload script through contextBridge. Keep it minimal and typed - every function is an IPC call
 * the main process validates. The web app mirrors these types in
 * `apps/web/src/app/core/desktop/desktop-bridge.ts` (it must not import from apps/desktop).
 */
export interface StorageInfo {
  /** The data folder in use (database, password key). */
  dataDir: string;
  /** The SQLite file. */
  databaseFile: string;
  appVersion: string;
  /** How the password key is protected: the OS keychain, or only a file with owner permissions. */
  keyProtection: 'os-keychain' | 'file';
}

/** Where the app's own update stands (electron-updater, from the GitHub releases). */
export type UpdateState =
  | { status: 'unsupported' }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

export interface DesktopBridge {
  readonly platform: string;
  readonly storage: {
    info(): Promise<StorageInfo>;
    /** Opens the data folder in Explorer / Finder. */
    reveal(): Promise<void>;
  };
  /** The PIN lock driven by the OS (lock screen, suspend, system idle). */
  readonly lock: {
    /** Called when the shell locked the app; returns an unsubscribe function. */
    onLocked(listener: (reason: string) => void): () => void;
    /** The person's auto-lock time, so the shell's system-idle check uses it. */
    setIdleMinutes(minutes: number): Promise<void>;
  };
  readonly updates: {
    state(): Promise<UpdateState>;
    check(): Promise<void>;
    /** Downloads the update found by `check`. */
    download(): Promise<void>;
    /** Quits and installs a downloaded update. */
    install(): Promise<void>;
    /** Called on every change; returns an unsubscribe function. */
    onState(listener: (state: UpdateState) => void): () => void;
  };
  /** The app's language for the shell's menus and dialogs (stored in the desktop config). */
  readonly locale: {
    set(locale: string): Promise<void>;
  };
}

export const IPC = {
  storageInfo: 'mb:storage:info',
  storageReveal: 'mb:storage:reveal',
  /** main → window: the app was locked (reason). */
  locked: 'mb:lock:locked',
  lockIdleMinutes: 'mb:lock:idle-minutes',
  localeSet: 'mb:locale:set',
  updateState: 'mb:update:state',
  updateCheck: 'mb:update:check',
  updateDownload: 'mb:update:download',
  updateInstall: 'mb:update:install',
  /** main -> window: the update state changed. */
  updateChanged: 'mb:update:changed',
} as const;
