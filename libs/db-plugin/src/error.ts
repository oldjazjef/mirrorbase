/**
 * Codes a plugin reports so the app can show a translated message instead of tool output. The
 * `message` stays English (logs, API clients); the UI maps the `code`.
 */
export type PluginErrorCode =
  | 'invalidConfig'
  | 'connectionFailed'
  | 'clientToolsMissing'
  | 'targetExists'
  | 'dumpFailed'
  | 'restoreFailed'
  | 'sourceMissing'
  | 'aborted';

export class PluginError extends Error {
  constructor(
    readonly code: PluginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginError';
  }
}
