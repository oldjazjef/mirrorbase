import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  powerMonitor,
  safeStorage,
  session,
  shell,
} from 'electron';
import { IPC, type StorageInfo } from '../shared/bridge';
import { type RunningApi, startApi } from './api-host';
import { isDesktopLocale } from './lib/messages';
import {
  LOCK_TICK_MS,
  LOCKING_EVENTS,
  type LockReason,
  LockWatch,
} from './lib/lock-watch';
import { type KeyProtection, loadOrCreateKey } from './lib/secret-key';
import { DATABASE_FILE, resolveDataDir, writeConfig } from './lib/storage';
import { APP_ORIGIN } from './lib/web-protocol';
import { messages, setMessagesLocale } from './messages';
import { handleAppScheme, registerAppScheme } from './protocol';
import { reportError } from './report';

// The packaged app and a dev run (`pnpm start:desktop`) must never share data.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'mirrorbase-dev'));
}

// One instance per user: two would open the same SQLite file with two writers.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

registerAppScheme();

// Windows ties notifications and the taskbar to an app user model id.
if (process.platform === 'win32')
  app.setAppUserModelId('app.mirrorbase.desktop');

/** main.js, preload.js, api/, web/ and migrations/ sit next to each other (scripts/stage.mjs). */
const appDir = __dirname;

/** `X.Y.Z+<commit>` - written into package.json's `mbBuild` by scripts/stage.mjs. */
const fullVersion = ((): string => {
  try {
    const manifest = JSON.parse(
      readFileSync(join(appDir, 'package.json'), 'utf8'),
    ) as {
      mbBuild?: { full?: unknown };
    };
    const full = manifest.mbBuild?.full;
    return typeof full === 'string' ? full : app.getVersion();
  } catch {
    return app.getVersion();
  }
})();

let mainWindow: BrowserWindow | null = null;
let api: RunningApi | null = null;
let dataDir = '';
let keyProtection: KeyProtection = 'file';
let lockTicker: NodeJS.Timeout | undefined;
let shutdownDone = false;
let lockWatch: LockWatch | null = null;

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Nothing in the window may open other windows, navigate away, or embed other content.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  if (shutdownDone) return;
  event.preventDefault();
  void shutdown().finally(() => {
    shutdownDone = true;
    app.quit();
  });
});

void app.whenReady().then(start);

async function start(): Promise<void> {
  const userData = app.getPath('userData');
  dataDir = resolveDataDir(userData, process.env);

  // The key that seals saved passwords: under the OS keychain where there is one.
  const key = loadOrCreateKey(dataDir, {
    // `basic_text` is Linux without a keyring: Electron "encrypts" with a hard-coded password
    // there, which is not protection.
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' ||
        safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (blob) => safeStorage.decryptString(blob),
  });
  keyProtection = key.protection;
  if (key.recovered) {
    console.warn(
      '[desktop] the saved-password key could not be opened; a new one was created, saved passwords must be entered again',
    );
  }

  api = await startApi({
    appDir,
    dataDir,
    workDir: join(app.getPath('temp'), 'mirrorbase'),
    encryptionKey: key.key,
  });
  handleAppScheme(join(appDir, 'web'), api);

  // The page asks for nothing from the browser: no camera, no location, nothing.
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  Menu.setApplicationMenu(buildMenu());
  registerIpc();
  startLockWatch();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'Mirrorbase',
    backgroundColor: '#0e1419',
    webPreferences: {
      preload: join(appDir, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadURL(`${APP_ORIGIN}/`);
}

/** The PIN lock, driven by the OS: lock screen, sleep, and system-wide inactivity. */
function startLockWatch(): void {
  lockWatch = new LockWatch({
    lock: (reason: LockReason) => {
      if (reason === 'start') return;
      api?.lockAll();
      mainWindow?.webContents.send(
        IPC.locked,
        reason === 'idle' ? 'idle' : 'system',
      );
    },
    systemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
  });
  for (const event of LOCKING_EVENTS) {
    (powerMonitor as unknown as NodeJS.EventEmitter).on(event, () =>
      lockWatch?.onSystemEvent(event),
    );
  }
  lockWatch.start();
  lockTicker = setInterval(() => lockWatch?.tick(), LOCK_TICK_MS);
}

/** Only the window we created may talk to the shell. */
function fromOurWindow(event: IpcMainInvokeEvent): boolean {
  return (
    mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) === true
  );
}

function registerIpc(): void {
  ipcMain.handle(IPC.storageInfo, (event): StorageInfo => {
    if (!fromOurWindow(event)) throw new Error('forbidden');
    return {
      dataDir,
      databaseFile: join(dataDir, DATABASE_FILE),
      appVersion: fullVersion,
      keyProtection,
    };
  });
  ipcMain.handle(IPC.storageReveal, (event) => {
    if (!fromOurWindow(event)) throw new Error('forbidden');
    void shell.openPath(dataDir);
  });
  ipcMain.handle(IPC.lockIdleMinutes, (event, minutes: unknown) => {
    if (!fromOurWindow(event)) throw new Error('forbidden');
    lockWatch?.setIdleMinutes(minutes);
  });
  ipcMain.handle(IPC.localeSet, (event, locale: unknown) => {
    if (!fromOurWindow(event)) throw new Error('forbidden');
    if (!isDesktopLocale(locale)) return;
    setMessagesLocale(locale);
    writeConfig(app.getPath('userData'), { locale });
  });
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        // Developer tools hold the page's data; only an unpackaged (development) run has them.
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              { role: 'reload' },
              { role: 'toggleDevTools' },
            ] as MenuItemConstructorOptions[])),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'About Mirrorbase',
          click: () => {
            app.setAboutPanelOptions({
              applicationName: 'Mirrorbase',
              applicationVersion: fullVersion,
              copyright: messages().about.credits,
            });
            app.showAboutPanel();
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

/** Closes the API (Prisma disconnects, the WAL is checkpointed) before the process ends. */
async function shutdown(): Promise<void> {
  if (lockTicker) clearInterval(lockTicker);
  try {
    await api?.close();
  } catch (error) {
    reportError('Shutdown', String(error), error);
  }
}
