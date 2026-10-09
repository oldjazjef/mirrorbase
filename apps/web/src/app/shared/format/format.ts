/** Bytes as "512 B", "1.5 KB", "12.3 MB", "1.20 GB" (binary units, one decimal). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes))
    return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** A duration between two ISO timestamps as "42 s", "3 min 05 s", "1 h 02 min". Open end = now. */
export function formatDuration(
  startIso: string | null,
  endIso: string | null,
  now: number = Date.now(),
): string {
  if (!startIso) return '';
  const end = endIso ? Date.parse(endIso) : now;
  const seconds = Math.max(0, Math.round((end - Date.parse(startIso)) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "12:05:09" in the local time zone - the log's time column. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * A short line for where a connection points, without knowing the database type: `host:port`
 * when the plugin has those settings, else a path, else the first few values.
 */
export function summarizeConfig(
  config: Readonly<Record<string, string | number | boolean | undefined>>,
): string {
  const host = config['host'];
  if (typeof host === 'string' && host.length > 0) {
    const port = config['port'];
    return port !== undefined ? `${host}:${port}` : host;
  }
  const path = config['path'];
  if (typeof path === 'string' && path.length > 0) return path;
  return Object.values(config)
    .filter(
      (value): value is string | number =>
        typeof value !== 'boolean' && value !== undefined,
    )
    .slice(0, 3)
    .join(' · ');
}
