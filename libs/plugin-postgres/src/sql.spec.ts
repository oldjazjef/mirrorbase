import { assertSafeDatabaseName, quoteIdent, quoteLiteral } from './sql';

describe('sql quoting', () => {
  it('doubles quotes', () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(quoteLiteral("o'brien")).toBe("'o''brien'");
  });

  it('keeps reserved words intact as identifiers', () => {
    expect(quoteIdent('authorization')).toBe('"authorization"');
  });

  it('refuses names libpq would read as a connection string', () => {
    expect(() => assertSafeDatabaseName('host=evil')).toThrow();
    expect(() => assertSafeDatabaseName('postgresql://x/y')).toThrow();
    expect(() => assertSafeDatabaseName('')).toThrow();
    expect(() => assertSafeDatabaseName('shop-2024')).not.toThrow();
  });
});
