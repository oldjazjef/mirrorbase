/**
 * Entry point of the API bundle the desktop app loads in-process (`webpack.desktop.config.js` →
 * `dist/apps/desktop-api/main.js`, a CommonJS library). It starts nothing on import: the Electron
 * main process sets the environment (DATABASE_URL in the data folder, SETTINGS_ENCRYPTION_KEY, …),
 * then `require`s this file and calls `bootstrap({ port: 0, … })`.
 */
export {
  bootstrap,
  type BootstrapOptions,
  DESKTOP_ACCESS_HEADER,
  type RunningApi,
} from './bootstrap';
