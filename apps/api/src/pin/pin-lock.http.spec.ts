import { Controller, Get, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { PinSessions, UNLOCK_HEADER } from './application/pin-sessions';
import { PinLockGuard } from './pin-lock.guard';
import { PinModule } from './pin.module';
import {
  AppPinRepositoryPort,
  SealedSecretsEraserPort,
} from './ports/app-pin.repository.port';
import {
  FakeSealedSecretsEraser,
  InMemoryAppPinRepository,
} from './testing/in-memory-app-pin.repository';

/** A data route - refused while locked. */
@Controller('data')
class DataController {
  @Get()
  get() {
    return { secret: 'data' };
  }
}

@Global()
@Module({
  providers: [
    { provide: ConfigService, useValue: { get: () => undefined } },
    { provide: AppPinRepositoryPort, useClass: InMemoryAppPinRepository },
    {
      provide: SealedSecretsEraserPort,
      useValue: new FakeSealedSecretsEraser(),
    },
  ],
  exports: [ConfigService, AppPinRepositoryPort, SealedSecretsEraserPort],
})
class TestPersistenceModule {}

@Module({
  imports: [TestPersistenceModule, PinModule],
  controllers: [DataController],
  providers: [{ provide: APP_GUARD, useExisting: PinLockGuard }],
})
class TestAppModule {}

describe('PIN lock over HTTP', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  });

  afterAll(() => app.close());

  const call = async (
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { [UNLOCK_HEADER]: options.token } : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  };

  it('is not an open door on a fresh install: data is refused until a PIN exists', async () => {
    const data = await call('GET', '/data');
    expect(data.status).toBe(423);
    expect(data.body['code']).toBe('pinNotSet');
    expect((await call('GET', '/pin/status')).body['hasPin']).toBe(false);
  });

  it('walks through set → data → lock → locked → unlock', async () => {
    const set = await call('PUT', '/pin', { body: { pin: '4711' } });
    expect(set.status).toBe(200);
    const token = set.body['token'] as string;

    expect((await call('GET', '/data', { token })).body).toEqual({
      secret: 'data',
    });
    expect((await call('GET', '/data')).body['code']).toBe('pinLocked');
    expect((await call('GET', '/data', { token: 'forged' })).status).toBe(423);

    expect((await call('POST', '/pin/lock', { token })).status).toBe(204);
    expect((await call('GET', '/data', { token })).body['code']).toBe(
      'pinLocked',
    );

    const wrong = await call('POST', '/pin/unlock', { body: { pin: '0000' } });
    expect(wrong.status).toBe(422);
    expect(wrong.body['code']).toBe('wrongPin');

    const right = await call('POST', '/pin/unlock', { body: { pin: '4711' } });
    // A wrong attempt costs nothing the first time, so the right PIN works at once.
    expect(right.status).toBe(200);
    expect(
      (await call('GET', '/data', { token: right.body['token'] as string }))
        .status,
    ).toBe(200);
  });

  it('refuses to change the PIN without the current one', async () => {
    const change = await call('PUT', '/pin', { body: { pin: '1111' } });
    expect(change.status).toBe(400);
    expect(change.body['code']).toBe('currentPinRequired');
  });

  it('rejects unknown properties instead of ignoring them', async () => {
    expect(
      (
        await call('POST', '/pin/unlock', {
          body: { pin: '4711', admin: true },
        })
      ).status,
    ).toBe(400);
  });

  it('locks every session at once when the OS locks the screen', async () => {
    const { body } = await call('POST', '/pin/unlock', {
      body: { pin: '4711' },
    });
    const token = body['token'] as string;
    expect((await call('GET', '/data', { token })).status).toBe(200);
    app.get(PinSessions).revokeAll();
    expect((await call('GET', '/data', { token })).status).toBe(423);
  });
});
