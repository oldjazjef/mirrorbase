import { formatBytes, formatDuration, summarizeConfig } from './format';

describe('formatBytes', () => {
  it('uses binary units with one decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });

  it('is empty when there is nothing to show', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });
});

describe('formatDuration', () => {
  const start = '2026-10-09T10:00:00Z';
  it('counts seconds, minutes and hours', () => {
    expect(formatDuration(start, '2026-10-09T10:00:42Z')).toBe('42 s');
    expect(formatDuration(start, '2026-10-09T10:03:05Z')).toBe('3 min 05 s');
    expect(formatDuration(start, '2026-10-09T11:02:00Z')).toBe('1 h 02 min');
  });

  it('measures a running task against now and is empty before it started', () => {
    expect(
      formatDuration(start, null, Date.parse('2026-10-09T10:00:10Z')),
    ).toBe('10 s');
    expect(formatDuration(null, null)).toBe('');
  });
});

describe('summarizeConfig', () => {
  it('reads host and port without knowing the database type', () => {
    expect(summarizeConfig({ host: 'db', port: 5433, user: 'u' })).toBe(
      'db:5433',
    );
    expect(summarizeConfig({ host: 'db' })).toBe('db');
  });

  it('falls back to a path, then to the first values', () => {
    expect(summarizeConfig({ path: '/data/a.db' })).toBe('/data/a.db');
    expect(summarizeConfig({ bucket: 'b', region: 'eu', ssl: true })).toBe(
      'b · eu',
    );
  });
});
