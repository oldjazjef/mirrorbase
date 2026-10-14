import type { UpdateState } from '../../shared/bridge';

/** What the controller needs of `electron-updater`'s `autoUpdater` - a fake in the specs. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(
    event: 'update-available',
    listener: (info: { version: string }) => void,
  ): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(
    event: 'download-progress',
    listener: (progress: { percent: number }) => void,
  ): unknown;
  on(
    event: 'update-downloaded',
    listener: (info: { version: string }) => void,
  ): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

/**
 * Looks for a newer release on GitHub, downloads it on request and installs it on restart. The
 * person decides every step (nothing downloads by itself), and the state is pushed to the window.
 *
 * `supported` is false for a development run and for macOS: an unsigned macOS app cannot replace
 * itself, so there the window offers the release page instead.
 */
export class UpdateController {
  private current: UpdateState;

  constructor(
    private readonly updater: UpdaterLike,
    supported: boolean,
    private readonly emit: (state: UpdateState) => void,
  ) {
    this.current = { status: supported ? 'idle' : 'unsupported' };
    if (!supported) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.on('update-available', (info) =>
      this.set({ status: 'available', version: info.version }),
    );
    updater.on('update-not-available', () => this.set({ status: 'none' }));
    updater.on('download-progress', (progress) =>
      this.set({
        status: 'downloading',
        percent: Math.min(100, Math.max(0, Math.round(progress.percent))),
      }),
    );
    updater.on('update-downloaded', (info) =>
      this.set({ status: 'ready', version: info.version }),
    );
    updater.on('error', (error) =>
      this.set({ status: 'error', message: error.message }),
    );
  }

  state(): UpdateState {
    return this.current;
  }

  async check(): Promise<void> {
    if (this.current.status === 'unsupported') return;
    // A check must not throw away a finished download or interrupt a running one.
    if (['checking', 'downloading', 'ready'].includes(this.current.status))
      return;
    this.set({ status: 'checking' });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.set({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async download(): Promise<void> {
    if (this.current.status !== 'available') return;
    this.set({ status: 'downloading', percent: 0 });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.set({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  install(): void {
    if (this.current.status === 'ready') this.updater.quitAndInstall();
  }

  private set(state: UpdateState): void {
    this.current = state;
    this.emit(state);
  }
}
