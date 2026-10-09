import type { PluginConnection } from './fields';
import type { HostContext } from './host';

/**
 * The neutral form for moving data BETWEEN database types (PostgreSQL → SQLite, …). Phase 1
 * copies within one type with the engine's own dump format and does not use this. The types exist
 * now so plugins and the transfer planner agree on the seam; a plugin opts in later by providing
 * `DatabasePlugin.interchange` — nothing else in the app changes.
 */
export type LogicalType =
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'text'
  | 'boolean'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'timestamptz'
  | 'binary'
  | 'json'
  | 'uuid';

export interface InterchangeColumn {
  readonly name: string;
  readonly type: LogicalType;
  readonly nullable: boolean;
  /** `decimal` only. */
  readonly precision?: number;
  readonly scale?: number;
  /** The source's own type name, for diagnostics ("numeric(10,2)"). */
  readonly nativeType: string;
}

export interface InterchangeTable {
  readonly schema?: string;
  readonly name: string;
  readonly columns: readonly InterchangeColumn[];
  readonly primaryKey: readonly string[];
}

export interface InterchangeSchema {
  readonly tables: readonly InterchangeTable[];
}

/**
 * Cell values are JSON-safe on purpose: numbers that can lose precision (decimal, bigint) are
 * decimal strings, binary is base64, timestamps are ISO 8601.
 */
export type InterchangeValue = string | number | boolean | null;

export interface InterchangeBatch {
  readonly table: string;
  readonly rows: readonly (readonly InterchangeValue[])[];
}

export interface InterchangeAdapter {
  readSchema(
    host: HostContext,
    connection: PluginConnection,
    database: string,
  ): Promise<InterchangeSchema>;
  readRows(
    host: HostContext,
    connection: PluginConnection,
    database: string,
    table: InterchangeTable,
  ): AsyncIterable<InterchangeBatch>;
  writeSchema(
    host: HostContext,
    connection: PluginConnection,
    database: string,
    schema: InterchangeSchema,
    options: { readonly replaceExisting: boolean },
  ): Promise<void>;
  writeRows(
    host: HostContext,
    connection: PluginConnection,
    database: string,
    batches: AsyncIterable<InterchangeBatch>,
  ): Promise<{ readonly rows: number }>;
}
