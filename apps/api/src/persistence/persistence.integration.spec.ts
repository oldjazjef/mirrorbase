import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { AppPinPrismaRepository } from './prisma/repositories/app-pin.prisma.repository';
import {
  ConnectionPrismaRepository,
  SealedSecretsEraserPrismaRepository,
} from './prisma/repositories/connection.prisma.repository';
import { LogPrismaRepository } from './prisma/repositories/log.prisma.repository';
import { RunPrismaRepository } from './prisma/repositories/run.prisma.repository';
import { ConnectionNameTakenError } from '../connections/domain/connection';

/**
 * The Prisma adapters against a real SQLite file with the real migrations - the only place that
 * can prove the unique name, the CHECK constraints, the foreign keys and the singleton PIN row.
 * `pnpm ci:integration` points DATABASE_URL at tmp/mirrorbase-test.db and migrates it first.
 */
describe('persistence (SQLite, real migrations)', () => {
  let prisma: PrismaService;
  let connections: ConnectionPrismaRepository;
  let runs: RunPrismaRepository;
  let logs: LogPrismaRepository;
  let pins: AppPinPrismaRepository;

  beforeAll(async () => {
    const url = process.env['DATABASE_URL'];
    if (!url)
      throw new Error('DATABASE_URL is not set: run `pnpm test:integration`');
    prisma = new PrismaService({ get: () => url } as unknown as ConfigService<
      never,
      true
    >);
    await prisma.onModuleInit();
    connections = new ConnectionPrismaRepository(prisma);
    runs = new RunPrismaRepository(prisma);
    logs = new LogPrismaRepository(prisma);
    pins = new AppPinPrismaRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.logEntry.deleteMany();
    await prisma.run.deleteMany();
    await prisma.connection.deleteMany();
    await prisma.appPin.deleteMany();
  });

  afterAll(() => prisma.onApplicationShutdown());

  const newConnection = (
    name: string,
    extra: Partial<Parameters<ConnectionPrismaRepository['create']>[0]> = {},
  ) =>
    connections.create({
      name,
      pluginId: 'postgres',
      config: { host: 'h', port: 5432 },
      sealedSecrets: { password: 'enc:v1:x:y:z' },
      dockerName: null,
      ...extra,
    });

  describe('connections', () => {
    it('round-trips config and sealed secrets', async () => {
      const created = await newConnection('Prod', { dockerName: 'pg16' });
      const found = (await connections.find(created.id))!;
      expect(found).toMatchObject({
        name: 'Prod',
        pluginId: 'postgres',
        config: { host: 'h', port: 5432 },
        sealedSecrets: { password: 'enc:v1:x:y:z' },
        secretKeys: ['password'],
        dockerName: 'pg16',
        lastUsedAt: null,
      });
    });

    it('keeps names unique and says so with a domain error', async () => {
      await newConnection('Prod');
      await expect(newConnection('Prod')).rejects.toBeInstanceOf(
        ConnectionNameTakenError,
      );
      const other = await newConnection('Other');
      await expect(
        connections.update(other.id, { name: 'Prod' }),
      ).rejects.toBeInstanceOf(ConnectionNameTakenError);
    });

    it('updates only what is sent and reports a missing row as null', async () => {
      const created = await newConnection('Prod');
      const updated = (await connections.update(created.id, {
        config: { host: 'new' },
      }))!;
      expect(updated.config).toEqual({ host: 'new' });
      expect(updated.sealedSecrets).toEqual({ password: 'enc:v1:x:y:z' });
      expect(await connections.update('missing', { name: 'x' })).toBeNull();
    });

    it('rejects values the CHECK constraints forbid', async () => {
      await expect(newConnection('   ')).rejects.toThrow();
      await expect(newConnection('x'.repeat(81))).rejects.toThrow();
      await expect(
        prisma.connection.create({
          data: { name: 'bad json', pluginId: 'p', config: 'not json' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.connection.create({
          data: { name: 'array', pluginId: 'p', config: '[]' },
        }),
      ).rejects.toThrow();
    });

    it('lists by name and tracks the last use', async () => {
      const b = await newConnection('B');
      await newConnection('A');
      expect((await connections.list()).map((c) => c.name)).toEqual(['A', 'B']);
      await connections.markUsed(b.id, new Date('2026-10-09T10:00:00Z'));
      expect((await connections.find(b.id))?.lastUsedAt).toBe(
        '2026-10-09T10:00:00.000Z',
      );
    });

    it('"PIN forgotten" erases every saved password and nothing else', async () => {
      const a = await newConnection('A');
      await newConnection('B', { sealedSecrets: {} });
      expect(
        await new SealedSecretsEraserPrismaRepository(prisma).eraseAll(),
      ).toBe(1);
      const after = (await connections.find(a.id))!;
      expect(after.sealedSecrets).toEqual({});
      expect(after.config).toEqual({ host: 'h', port: 5432 });
    });
  });

  describe('runs', () => {
    const newRun = async (
      extra: { sourceConnectionId?: string; targetConnectionId?: string } = {},
    ) => {
      const a =
        extra.sourceConnectionId ??
        (await newConnection(`src-${Math.random()}`)).id;
      const b =
        extra.targetConnectionId ??
        (await newConnection(`dst-${Math.random()}`)).id;
      return runs.create({
        sourceConnectionId: a,
        targetConnectionId: b,
        sourceName: 'Source',
        targetName: 'Target',
        sourcePluginId: 'postgres',
        targetPluginId: 'postgres',
        strategy: 'native',
        replaceExisting: true,
        databases: [
          {
            source: 'shop',
            target: 'shop',
            status: 'pending',
            bytes: null,
            warnings: 0,
            errorCode: null,
            error: null,
          },
        ],
      });
    };

    it('stores a run, its databases and their progress', async () => {
      const run = await newRun();
      expect(run).toMatchObject({
        status: 'queued',
        replaceExisting: true,
        startedAt: null,
      });
      const updated = (await runs.update(run.id, {
        status: 'running',
        startedAt: new Date('2026-10-09T10:00:00Z'),
        databases: [{ ...run.databases[0]!, status: 'dumping' }],
      }))!;
      expect(updated.status).toBe('running');
      expect(updated.databases[0]?.status).toBe('dumping');
      expect(updated.startedAt).toBe('2026-10-09T10:00:00.000Z');
      expect(await runs.update('missing', { status: 'failed' })).toBeNull();
    });

    it('finds the active run and fails interrupted ones', async () => {
      expect(await runs.findActive()).toBeNull();
      const run = await newRun();
      expect((await runs.findActive())?.id).toBe(run.id);
      expect(
        await runs.failInterrupted(new Date('2026-10-09T11:00:00Z'), 'closed'),
      ).toBe(1);
      expect(await runs.findActive()).toBeNull();
      expect(await runs.find(run.id)).toMatchObject({
        status: 'failed',
        error: 'closed',
      });
    });

    it('keeps the history readable after a connection is deleted', async () => {
      const run = await newRun();
      await connections.delete(run.sourceConnectionId!);
      const after = (await runs.find(run.id))!;
      expect(after.sourceConnectionId).toBeNull();
      expect(after.sourceName).toBe('Source');
    });

    it('rejects an invalid status or strategy', async () => {
      const run = await newRun();
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE run SET status = 'bogus' WHERE id = '${run.id}'`,
        ),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE run SET strategy = 'magic' WHERE id = '${run.id}'`,
        ),
      ).rejects.toThrow();
    });

    it('lists newest first', async () => {
      const first = await newRun();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await newRun();
      expect((await runs.list(10)).map((r) => r.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(await runs.list(1)).toHaveLength(1);
    });
  });

  describe('log', () => {
    it('appends and reads by run, level and cursor', async () => {
      const connection = await newConnection('c');
      const run = await runs.create({
        sourceConnectionId: connection.id,
        targetConnectionId: connection.id,
        sourceName: 's',
        targetName: 't',
        sourcePluginId: 'postgres',
        targetPluginId: 'postgres',
        strategy: 'native',
        replaceExisting: false,
        databases: [],
      });
      await logs.append([
        { runId: run.id, level: 'info', message: 'one' },
        { runId: run.id, level: 'warn', message: 'two' },
        { runId: null, level: 'error', message: 'app' },
        { runId: run.id, level: 'debug', message: 'three' },
      ]);

      const ofRun = await logs.list({ runId: run.id, limit: 10 });
      expect(ofRun.map((e) => e.message)).toEqual(['three', 'two', 'one']); // newest first
      expect(
        (await logs.list({ runId: run.id, minLevel: 'warn', limit: 10 })).map(
          (e) => e.message,
        ),
      ).toEqual(['two']);
      expect(
        (await logs.list({ appOnly: true, limit: 10 })).map((e) => e.message),
      ).toEqual(['app']);

      const firstId = ofRun[2]!.id;
      expect(
        (await logs.list({ runId: run.id, afterId: firstId, limit: 10 })).map(
          (e) => e.message,
        ),
      ).toEqual(['two', 'three']); // polling: oldest first
      expect(
        (await logs.list({ beforeId: ofRun[0]!.id, limit: 10 })).map(
          (e) => e.message,
        ),
      ).toEqual(['app', 'two', 'one']);
    });

    it('rejects an unknown level and prunes old entries', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO log_entry (level, message) VALUES ('loud', 'x')`,
        ),
      ).rejects.toThrow();
      await prisma.$executeRawUnsafe(
        `INSERT INTO log_entry (level, message, at) VALUES ('info', 'ancient', '2020-01-01 00:00:00')`,
      );
      await logs.append([{ runId: null, level: 'info', message: 'fresh' }]);
      expect(await logs.prune(new Date('2026-01-01T00:00:00Z'))).toBe(1);
      expect((await logs.list({ limit: 10 })).map((e) => e.message)).toEqual([
        'fresh',
      ]);
    });

    it("deletes a run's log with the run", async () => {
      const c = await newConnection('c');
      const run = await runs.create({
        sourceConnectionId: c.id,
        targetConnectionId: c.id,
        sourceName: 's',
        targetName: 't',
        sourcePluginId: 'postgres',
        targetPluginId: 'postgres',
        strategy: 'native',
        replaceExisting: false,
        databases: [],
      });
      await logs.append([{ runId: run.id, level: 'info', message: 'x' }]);
      await prisma.run.delete({ where: { id: run.id } });
      expect(await logs.list({ limit: 10 })).toEqual([]);
    });
  });

  describe('PIN', () => {
    it('is a singleton: save creates it, a second save replaces it', async () => {
      expect(await pins.find()).toBeNull();
      await pins.save({
        pinHash: 'scrypt$15$8$1$a$b',
        failedAttempts: 0,
        nextAttemptAt: null,
        autoLockMinutes: 15,
      });
      const second = await pins.save({
        pinHash: 'scrypt$15$8$1$c$d',
        failedAttempts: 2,
        nextAttemptAt: '2026-10-09T10:00:05.000Z',
        autoLockMinutes: 30,
      });
      expect(second).toMatchObject({
        pinHash: 'scrypt$15$8$1$c$d',
        failedAttempts: 2,
        nextAttemptAt: '2026-10-09T10:00:05.000Z',
        autoLockMinutes: 30,
      });
      expect(await prisma.appPin.count()).toBe(1);
      await pins.delete();
      expect(await pins.find()).toBeNull();
    });

    it('refuses a second row, a non-scrypt hash and an auto-lock out of range', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO app_pin (id, pin_hash, updated_at) VALUES (2, 'scrypt$x', CURRENT_TIMESTAMP)`,
        ),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO app_pin (id, pin_hash, updated_at) VALUES (1, '1234', CURRENT_TIMESTAMP)`,
        ),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO app_pin (id, pin_hash, auto_lock_minutes, updated_at) VALUES (1, 'scrypt$x', 0, CURRENT_TIMESTAMP)`,
        ),
      ).rejects.toThrow();
    });
  });
});
