import { HttpErrorResponse } from '@angular/common/http';

/** A translatable text: an i18n key and its values. */
export interface ErrorText {
  readonly key: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * The API's error **codes** are the contract - its `message` is English, for logs and the OpenAPI
 * document, and never shown as such. A failed request is told to the person by its code
 * (`errors.api.<code>`) or, without a known code, by its HTTP status (`errors.status.<name>`).
 * This includes the codes database plugins report (`clientToolsMissing`, `targetExists`, …).
 */
export const API_ERROR_CODES = [
  // connections
  'connectionNotFound',
  'nameTaken',
  'invalidName',
  'invalidConnection',
  'unknownPlugin',
  'pluginMismatch',
  'secretsUnavailable',
  // runs
  'runNotFound',
  'runInProgress',
  'runNotActive',
  'noDatabases',
  'tooManyDatabases',
  'duplicateTarget',
  'sameDatabase',
  'transferUnsupported',
  // plugin errors
  'invalidConfig',
  'connectionFailed',
  'clientToolsMissing',
  'targetExists',
  'dumpFailed',
  'restoreFailed',
  'sourceMissing',
  'aborted',
  // PIN
  'noPin',
  'invalidPin',
  'currentPinRequired',
  'wrongPin',
  'pinThrottled',
  'confirmationRequired',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** HTTP statuses with a text of their own; every other 5xx is `server`. */
export const HTTP_STATUS_TEXTS = {
  0: 'unreachable',
  400: 'badRequest',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
  422: 'unprocessable',
  423: 'locked',
  429: 'rateLimited',
} as const satisfies Record<number, string>;
export const HTTP_STATUS_NAMES = [
  ...Object.values(HTTP_STATUS_TEXTS),
  'server',
] as const;

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === 'string' &&
    (API_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** The code the API sent, if any. */
export function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpErrorResponse)) return undefined;
  const code: unknown = (error.error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** The translatable reason of a failed API call, or `undefined` when it was no HTTP error. */
export function apiErrorText(error: unknown): ErrorText | undefined {
  if (!(error instanceof HttpErrorResponse)) return undefined;
  const code = apiErrorCode(error);
  if (isApiErrorCode(code)) return { key: `errors.api.${code}` };
  const named = (HTTP_STATUS_TEXTS as Readonly<Record<number, string>>)[
    error.status
  ];
  if (named) return { key: `errors.status.${named}` };
  if (error.status >= 500) return { key: 'errors.status.server' };
  return undefined;
}
