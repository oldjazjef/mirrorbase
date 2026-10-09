import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type {
  Connection,
  Plugin,
  Run,
  StartRunRequest,
  TransferPlan,
} from '../../../../core/api/api.types';
import { ConnectionsService } from '../../../../core/connections/connections.service';
import { PluginsService } from '../../../../core/plugins/plugins.service';
import { RunsService } from '../../../../core/runs/runs.service';
import { ReplicatePageService } from './replicate-page.service';

const plugin = (id: string, multi: boolean): Plugin => ({
  id,
  name: id,
  description: { en: id },
  version: '1.0.0',
  icon: 'database',
  capabilities: {
    canBeSource: true,
    canBeTarget: true,
    multipleDatabases: multi,
    dockerDiscovery: false,
  },
  fields: [],
  dumpFormat: `${id}@1`,
});

const connection = (id: string, pluginId: string): Connection => ({
  id,
  name: `Conn ${id}`,
  pluginId,
  config: { host: id },
  secretKeys: [],
  dockerName: null,
  createdAt: '2026-10-09T10:00:00Z',
  updatedAt: '2026-10-09T10:00:00Z',
  lastUsedAt: null,
});

const run = (over: Partial<Run> = {}): Run => ({
  id: 'run-1',
  status: 'running',
  sourceConnectionId: 'pg1',
  targetConnectionId: 'pg2',
  sourceName: 'A',
  targetName: 'B',
  sourcePluginId: 'postgres',
  targetPluginId: 'postgres',
  strategy: 'native',
  replaceExisting: false,
  databases: [],
  error: null,
  createdAt: '2026-10-09T10:00:00Z',
  startedAt: '2026-10-09T10:00:01Z',
  finishedAt: null,
  ...over,
});

class FakeConnections {
  readonly connections = signal<readonly Connection[]>([
    connection('pg1', 'postgres'),
    connection('pg2', 'postgres'),
    connection('lite', 'sqlite'),
  ]);
  databases = vi.fn((id: string): Promise<string[]> =>
    Promise.resolve(id === 'lite' ? ['orders'] : ['shop', 'crm']),
  );
  reload = vi.fn();
  reloadDocker = vi.fn();
  find(id: string | null | undefined): Connection | undefined {
    return this.connections().find((c) => c.id === id);
  }
}

class FakePlugins {
  readonly plugins = signal<readonly Plugin[]>([
    plugin('postgres', true),
    plugin('sqlite', false),
  ]);
  planFor: (source: string, target: string) => TransferPlan = (s, t) =>
    s === t
      ? { kind: 'native' }
      : { kind: 'unsupported', reason: 'crossEngineUnavailable' };
  find(id: string): Plugin | undefined {
    return this.plugins().find((p) => p.id === id);
  }
  plan(source: string, target: string): Promise<TransferPlan> {
    return Promise.resolve(this.planFor(source, target));
  }
}

class FakeRuns {
  started: StartRunRequest[] = [];
  active: Run | null = null;
  fresh: Run = run({ status: 'succeeded', finishedAt: '2026-10-09T10:00:09Z' });
  start = vi.fn((request: StartRunRequest) => {
    this.started.push(request);
    return Promise.resolve(run({ status: 'queued' }));
  });
  cancel = vi.fn((id: string) => Promise.resolve(run({ id })));
  get = vi.fn(() => Promise.resolve(this.fresh));
  list = vi.fn(() => Promise.resolve(this.active ? [this.active] : []));
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const connections = new FakeConnections();
  const plugins = new FakePlugins();
  const runs = new FakeRuns();
  TestBed.configureTestingModule({
    providers: [
      provideTranslateService(),
      { provide: ConnectionsService, useValue: connections },
      { provide: PluginsService, useValue: plugins },
      { provide: RunsService, useValue: runs },
    ],
  });
  return {
    connections,
    plugins,
    runs,
    service: TestBed.inject(ReplicatePageService),
  };
}

async function flush(): Promise<void> {
  TestBed.tick();
  await settle();
  TestBed.tick();
  await settle();
}

describe('ReplicatePageService', () => {
  afterEach(() => {
    TestBed.inject(ReplicatePageService).dispose();
    vi.useRealTimers();
  });

  it('loads the databases of the chosen source; none are selected on a server with many', async () => {
    const { service, connections } = setup();
    service.choose('source', 'pg1');
    await flush();
    expect(connections.databases).toHaveBeenCalledWith('pg1');
    expect(service.loadState()).toBe('ready');
    expect(
      service.databases().map((d) => [d.name, d.selected, d.target]),
    ).toEqual([
      ['shop', false, 'shop'],
      ['crm', false, 'crm'],
    ]);
  });

  it('selects the one database of a file-based source for the person', async () => {
    const { service } = setup();
    service.choose('source', 'lite');
    await flush();
    expect(service.sourceIsMulti()).toBe(false);
    expect(service.databases().map((d) => d.selected)).toEqual([true]);
  });

  it('says why Start is not possible, step by step', async () => {
    const { service } = setup();
    expect(service.blocker()).toBe('replicate.blocker.pickBoth');
    service.choose('source', 'pg1');
    service.choose('target', 'pg2');
    await flush();
    expect(service.blocker()).toBe('replicate.blocker.selectOne');
    service.toggle('shop');
    expect(service.blocker()).toBeNull();
    expect(service.canStart()).toBe(true);

    service.rename('shop', '  ');
    expect(service.blocker()).toBe('replicate.blocker.emptyName');
    service.rename('shop', 'crm');
    service.toggle('crm');
    expect(service.blocker()).toBe('replicate.blocker.duplicateName');
  });

  it('blocks Start for two database types that cannot be copied between yet', async () => {
    const { service } = setup();
    service.choose('source', 'pg1');
    service.choose('target', 'lite');
    await flush();
    service.toggle('shop');
    expect(service.plan()).toEqual({
      kind: 'unsupported',
      reason: 'crossEngineUnavailable',
    });
    expect(service.blocker()).toBe('replicate.blocker.unsupported');
  });

  it('selects all and none', async () => {
    const { service } = setup();
    service.choose('source', 'pg1');
    await flush();
    service.toggleAll();
    expect(service.selection()).toHaveLength(2);
    expect(service.allSelected()).toBe(true);
    service.toggleAll();
    expect(service.selection()).toHaveLength(0);
  });

  it('reports a failed listing by its error code and clears when the source is cleared', async () => {
    const { service, connections } = setup();
    const { HttpErrorResponse } = await import('@angular/common/http');
    connections.databases.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 422,
        error: { code: 'connectionFailed' },
      }),
    );
    service.choose('source', 'pg1');
    await flush();
    expect(service.loadState()).toBe('failed');
    expect(service.loadErrorCode()).toBe('connectionFailed');
    service.choose('source', '');
    await flush();
    expect(service.loadState()).toBe('idle');
  });

  it('starts with the chosen names and follows the run to its end', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { service, runs } = setup();
    service.choose('source', 'pg1');
    service.choose('target', 'pg2');
    await flush();
    service.toggle('shop');
    service.rename('shop', 'shop_copy');

    service.requestStart();
    await flush();
    expect(runs.started).toEqual([
      {
        sourceId: 'pg1',
        targetId: 'pg2',
        databases: [{ source: 'shop', target: 'shop_copy' }],
        replaceExisting: false,
      },
    ]);
    expect(service.run()?.status).toBe('queued');
    expect(service.runActive()).toBe(true);
    expect(service.blocker()).toBe('replicate.blocker.running');

    await vi.advanceTimersByTimeAsync(1000);
    expect(runs.get).toHaveBeenCalled();
    expect(service.run()?.status).toBe('succeeded');
    expect(service.runActive()).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(runs.get).toHaveBeenCalledTimes(1); // polling stopped with the run
  });

  it('asks before replacing: nothing starts until the person confirms', async () => {
    const { service, runs } = setup();
    service.choose('source', 'pg1');
    service.choose('target', 'pg2');
    await flush();
    service.toggle('shop');
    service.replaceExisting.set(true);

    service.requestStart();
    await flush();
    expect(service.confirmOpen()).toBe(true);
    expect(runs.start).not.toHaveBeenCalled();

    service.cancelConfirm();
    expect(runs.start).not.toHaveBeenCalled();

    service.requestStart();
    await service.start();
    expect(runs.started[0]?.replaceExisting).toBe(true);
    expect(service.confirmOpen()).toBe(false);
  });

  it('sends the source name when the target is a file (its name does not matter)', async () => {
    const { service, runs } = setup();
    service.choose('source', 'lite');
    service.choose('target', 'lite');
    await flush();
    expect(service.namesMatter()).toBe(false);
    service.rename('orders', 'ignored-because-names-do-not-matter');
    await service.start();
    expect(runs.started[0]?.databases).toEqual([
      { source: 'orders', target: 'orders' },
    ]);
  });

  it('picks up a run that is already in progress when the page opens', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { runs } = (() => {
      const connections = new FakeConnections();
      const runs = new FakeRuns();
      runs.active = run({ status: 'running' });
      TestBed.configureTestingModule({
        providers: [
          provideTranslateService(),
          { provide: ConnectionsService, useValue: connections },
          { provide: PluginsService, useValue: new FakePlugins() },
          { provide: RunsService, useValue: runs },
        ],
      });
      return { runs };
    })();
    const service = TestBed.inject(ReplicatePageService);
    await flush();
    expect(runs.list).toHaveBeenCalled();
    expect(service.run()?.id).toBe('run-1');
    expect(service.runActive()).toBe(true);
  });

  it('cancels the run it follows', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { service, runs } = setup();
    service.choose('source', 'pg1');
    service.choose('target', 'pg2');
    await flush();
    service.toggle('shop');
    await service.start();
    await service.cancelRun();
    expect(runs.cancel).toHaveBeenCalledWith('run-1');
  });
});
