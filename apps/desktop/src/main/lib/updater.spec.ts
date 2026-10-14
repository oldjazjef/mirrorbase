import type { UpdateState } from '../../shared/bridge';
import { UpdateController, type UpdaterLike } from './updater';

function fakeUpdater() {
  const listeners = new Map<string, (arg?: never) => void>();
  const calls: string[] = [];
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on(event: string, listener: (arg?: never) => void) {
      listeners.set(event, listener);
    },
    checkForUpdates: () => {
      calls.push('check');
      return Promise.resolve();
    },
    downloadUpdate: () => {
      calls.push('download');
      return Promise.resolve();
    },
    quitAndInstall: () => {
      calls.push('install');
    },
  } as unknown as UpdaterLike;
  const fire = (event: string, arg?: unknown) =>
    (listeners.get(event) as (a?: unknown) => void)(arg);
  return { updater, calls, fire };
}

function controller(supported = true) {
  const fake = fakeUpdater();
  const states: UpdateState[] = [];
  const instance = new UpdateController(fake.updater, supported, (state) =>
    states.push(state),
  );
  return { ...fake, instance, states };
}

describe('UpdateController', () => {
  it('never downloads by itself', () => {
    const { updater } = controller();
    expect(updater.autoDownload).toBe(false);
  });

  it('is unsupported (and inert) when the app cannot replace itself', async () => {
    const { instance, calls } = controller(false);
    await instance.check();
    expect(instance.state()).toEqual({ status: 'unsupported' });
    expect(calls).toEqual([]);
  });

  it('goes from checking to available, downloading and ready', async () => {
    const { instance, calls, fire, states } = controller();
    await instance.check();
    fire('update-available', { version: '1.2.0' });
    await instance.download();
    fire('download-progress', { percent: 41.6 });
    fire('update-downloaded', { version: '1.2.0' });
    instance.install();
    expect(states.map((s) => s.status)).toEqual([
      'checking',
      'available',
      'downloading',
      'downloading',
      'ready',
    ]);
    expect(states[3]).toEqual({ status: 'downloading', percent: 42 });
    expect(calls).toEqual(['check', 'download', 'install']);
  });

  it('reports when there is nothing new', async () => {
    const { instance, fire } = controller();
    await instance.check();
    fire('update-not-available');
    expect(instance.state()).toEqual({ status: 'none' });
  });

  it('only downloads an available update and only installs a finished one', async () => {
    const { instance, calls } = controller();
    await instance.download();
    instance.install();
    expect(calls).toEqual([]);
  });

  it('does not check again while a download is running or finished', async () => {
    const { instance, calls, fire } = controller();
    await instance.check();
    fire('update-available', { version: '1.2.0' });
    await instance.download();
    await instance.check();
    expect(calls).toEqual(['check', 'download']);
    fire('update-downloaded', { version: '1.2.0' });
    await instance.check();
    expect(calls).toEqual(['check', 'download']);
  });

  it('turns a failure into an error state', async () => {
    const { instance, fire } = controller();
    fire('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(instance.state()).toEqual({
      status: 'error',
      message: 'net::ERR_INTERNET_DISCONNECTED',
    });
  });
});
