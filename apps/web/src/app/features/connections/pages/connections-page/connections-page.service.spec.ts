import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  Connection,
  DockerDatabase,
  DockerDatabases,
} from '../../../../core/api/api.types';
import { ConnectionsService } from '../../../../core/connections/connections.service';
import { PluginsService } from '../../../../core/plugins/plugins.service';
import { ConnectionsPageService } from './connections-page.service';

const container = (index: number): DockerDatabase => ({
  pluginId: 'postgres',
  pluginName: 'PostgreSQL',
  containerId: `id${index}`,
  containerName: `box${index}`,
  name: `box${index}`,
  config: {},
  summary: 'postgres:16',
  state: 'running',
  savedConnectionId: null,
});

function setup(count: number) {
  const value = signal<DockerDatabases>({
    available: true,
    reason: null,
    items: Array.from({ length: count }, (_, i) => container(i + 1)),
  });
  const connections = {
    connections: signal<readonly Connection[]>([]),
    docker: { hasValue: () => true, value },
    reloadDocker: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ConnectionsService, useValue: connections },
      { provide: PluginsService, useValue: { find: () => undefined } },
    ],
  });
  return { value, service: TestBed.inject(ConnectionsPageService) };
}

describe('ConnectionsPageService docker list', () => {
  it('shows five containers per page and moves between pages', () => {
    const { service } = setup(12);
    expect(service.dockerPageCount()).toBe(3);
    expect(service.dockerPageItems().map((i) => i.containerName)).toEqual([
      'box1',
      'box2',
      'box3',
      'box4',
      'box5',
    ]);
    service.moveDockerPage(1);
    service.moveDockerPage(1);
    expect(service.dockerPageItems()).toHaveLength(2);
    service.moveDockerPage(1);
    expect(service.dockerPageIndex()).toBe(2);
    service.moveDockerPage(-5);
    expect(service.dockerPageIndex()).toBe(0);
  });

  it('falls back to the last page when a refresh shortens the list', () => {
    const { service, value } = setup(12);
    service.moveDockerPage(2);
    value.set({ ...value(), items: value().items.slice(0, 6) });
    expect(service.dockerPageIndex()).toBe(1);
    expect(service.dockerPageItems()).toHaveLength(1);
  });
});
