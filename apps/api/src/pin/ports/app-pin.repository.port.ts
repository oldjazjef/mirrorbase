import type { AppPin, SaveAppPinInput } from '../domain/pin';

/** The one PIN row. Contract and DI token in one - bound in PersistenceModule. */
export abstract class AppPinRepositoryPort {
  abstract find(): Promise<AppPin | null>;
  /** Creates the PIN or replaces it. */
  abstract save(input: SaveAppPinInput): Promise<AppPin>;
  abstract delete(): Promise<void>;
}

/**
 * "PIN forgotten": the sealed passwords are unreadable without the PIN-protected session anyway,
 * but a reset must not leave them lying around for whoever resets the PIN next. A separate port
 * because it reaches into another slice's table (connections).
 */
export abstract class SealedSecretsEraserPort {
  /** Removes every stored password; returns how many connections lost one. */
  abstract eraseAll(): Promise<number>;
}
