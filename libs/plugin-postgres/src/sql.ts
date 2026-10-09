import { PluginError } from '@dbreplicator/db-plugin';

/** A PostgreSQL identifier, quoted: `"` doubled. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** A PostgreSQL string literal (standard_conforming_strings): `'` doubled. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * libpq treats a `-d` value containing `=` or starting with a URI scheme as a whole connection
 * string, which would let a database NAME redirect the connection. Such names are legal in
 * PostgreSQL but vanishingly rare; refusing them is the safe trade.
 */
export function assertSafeDatabaseName(name: string): void {
  if (
    name.length === 0 ||
    name.includes('\0') ||
    name.includes('=') ||
    /^postgres(ql)?:\/\//i.test(name)
  ) {
    throw new PluginError(
      'invalidConfig',
      `The database name ${JSON.stringify(name)} is not supported`,
    );
  }
}
