import { Test } from '@nestjs/testing';
import { DockerPort } from '../docker/ports/docker.port';
import { ReplicationExecutor } from '../replication/application/replication-executor';
import { StartRunHandler } from '../replication/application/run.handlers';
import { PluginRegistry } from '../plugins/plugin-registry';
import { AppModule } from './app.module';

/**
 * Compiles the whole module graph - every provider must be resolvable - without opening a
 * database connection (PrismaService connects in onModuleInit, which `compile()` does not run).
 * The environment placeholders come from vitest.config.ts. Catches the classic Nest failure of a
 * handler depending on a port no module binds.
 */
describe('AppModule', () => {
  it('resolves every provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(moduleRef.get(StartRunHandler)).toBeInstanceOf(StartRunHandler);
    expect(moduleRef.get(ReplicationExecutor)).toBeDefined();
    expect(moduleRef.get(DockerPort)).toBeDefined();
    expect(
      moduleRef
        .get(PluginRegistry)
        .all()
        .map((p) => p.id),
    ).toEqual(['postgres', 'sqlite']);
    await moduleRef.close();
  });
});
