/**
 * Runtime configuration, read from `public/env.js` rather than baked into the bundle. There is
 * exactly one value - the API's base URL - because everything else the app needs it asks the API.
 */
export interface RuntimeEnv {
  /** Base URL of the API, without `/api`. Empty = same origin (dev-server proxy, app:// proxy). */
  apiBaseUrl: string;
}

declare global {
  interface Window {
    __MB_ENV__?: Partial<RuntimeEnv>;
  }
}

export function runtimeEnv(): RuntimeEnv {
  const provided = window.__MB_ENV__ ?? {};
  return {
    apiBaseUrl: readString(provided.apiBaseUrl, '').replace(/\/+$/, ''),
  };
}

/** An empty string is what a generated env.js writes for a value that was never passed. */
function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}
