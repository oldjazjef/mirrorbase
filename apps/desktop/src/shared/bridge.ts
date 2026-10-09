/**
 * The window's only access to the desktop shell: `window.dbreplicatorDesktop`, exposed by the
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
  /** The app's language for the shell's menus and dialogs (stored in the desktop config). */
  readonly locale: {
    set(locale: string): Promise<void>;
  };
}

export const IPC = {
  storageInfo: 'dr:storage:info',
  storageReveal: 'dr:storage:reveal',
  /** main → window: the app was locked (reason). */
  locked: 'dr:lock:locked',
  lockIdleMinutes: 'dr:lock:idle-minutes',
  localeSet: 'dr:locale:set',
} as const;
