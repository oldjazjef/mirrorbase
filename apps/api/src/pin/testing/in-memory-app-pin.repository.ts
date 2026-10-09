import type { AppPin, SaveAppPinInput } from '../domain/pin';
import {
  AppPinRepositoryPort,
  SealedSecretsEraserPort,
} from '../ports/app-pin.repository.port';

export class InMemoryAppPinRepository extends AppPinRepositoryPort {
  pin: AppPin | null = null;

  find(): Promise<AppPin | null> {
    return Promise.resolve(this.pin);
  }

  save(input: SaveAppPinInput): Promise<AppPin> {
    this.pin = { ...input, updatedAt: new Date().toISOString() };
    return Promise.resolve(this.pin);
  }

  delete(): Promise<void> {
    this.pin = null;
    return Promise.resolve();
  }
}

export class FakeSealedSecretsEraser extends SealedSecretsEraserPort {
  erased = 0;
  constructor(private readonly toErase = 2) {
    super();
  }
  eraseAll(): Promise<number> {
    this.erased++;
    return Promise.resolve(this.toErase);
  }
}
