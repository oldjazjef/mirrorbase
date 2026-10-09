import { extendedPath } from './path-env';

describe('extendedPath', () => {
  it('adds the usual docker and psql folders after the existing PATH on macOS', () => {
    const result = extendedPath('/usr/bin:/bin', 'darwin', ':').split(':');
    expect(result.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    expect(result).toEqual(
      expect.arrayContaining(['/opt/homebrew/bin', '/usr/local/bin']),
    );
  });

  it('never shadows what the system provides and does not repeat folders', () => {
    const result = extendedPath('/usr/local/bin:/usr/bin', 'linux', ':').split(
      ':',
    );
    expect(result[0]).toBe('/usr/local/bin');
    expect(result.filter((dir) => dir === '/usr/local/bin')).toHaveLength(1);
  });

  it('leaves Windows alone and copes with an empty PATH', () => {
    expect(extendedPath('C:\\Windows', 'win32', ';')).toBe('C:\\Windows');
    expect(extendedPath(undefined, 'win32', ';')).toBe('');
  });
});
