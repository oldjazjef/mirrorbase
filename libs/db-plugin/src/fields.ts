import type { LocalizedText } from './text';

/**
 * How the app renders and validates a plugin's connection settings WITHOUT knowing the plugin: a
 * plugin declares its fields, the UI draws the form, the API validates and stores the values.
 * A new database type therefore needs no change in the web app.
 */
export type FieldType =
  'text' | 'number' | 'password' | 'path' | 'select' | 'boolean';

export type FieldValue = string | number | boolean;

export interface FieldOption {
  readonly value: string;
  readonly label: LocalizedText;
}

export interface FieldDescriptor {
  /** Key in the connection's `config` (or `secrets` for a secret field). */
  readonly key: string;
  readonly type: FieldType;
  readonly label: LocalizedText;
  readonly help?: LocalizedText;
  readonly placeholder?: string;
  readonly required?: boolean;
  /**
   * Stored sealed (AES-256-GCM), never returned by the API, never logged. A secret field is
   * rendered as a password input; the API only reports whether one is set.
   */
  readonly secret?: boolean;
  readonly default?: FieldValue;
  /** `select` only. */
  readonly options?: readonly FieldOption[];
  /** `number` only. */
  readonly min?: number;
  readonly max?: number;
  /** `text` only: the whole value must match. */
  readonly pattern?: string;
  /** Shown under "Advanced" — rarely changed settings. */
  readonly advanced?: boolean;
}

/** The non-secret settings of one saved connection. */
export type ConnectionConfig = Readonly<Record<string, FieldValue | undefined>>;

/** A connection as a plugin receives it: settings plus the opened secrets. */
export interface PluginConnection {
  readonly config: ConnectionConfig;
  readonly secrets: Readonly<Record<string, string>>;
}

export type ProblemCode =
  | 'required'
  | 'invalidNumber'
  | 'outOfRange'
  | 'invalidOption'
  | 'invalidFormat';

export interface FieldProblem {
  readonly field: string;
  readonly code: ProblemCode;
}

/** The value of a field, with its default applied. */
export function fieldValue(
  field: FieldDescriptor,
  connection: PluginConnection,
): FieldValue | undefined {
  const raw = field.secret
    ? connection.secrets[field.key]
    : connection.config[field.key];
  if (raw === undefined || raw === '') return field.default;
  return raw;
}

/** Validates a connection against the declared fields. The default `DatabasePlugin.validate`. */
export function validateFields(
  fields: readonly FieldDescriptor[],
  connection: PluginConnection,
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  for (const field of fields) {
    const value = fieldValue(field, connection);
    if (value === undefined) {
      if (field.required) problems.push({ field: field.key, code: 'required' });
      continue;
    }
    if (field.type === 'number') {
      const number = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(number)) {
        problems.push({ field: field.key, code: 'invalidNumber' });
      } else if (
        (field.min !== undefined && number < field.min) ||
        (field.max !== undefined && number > field.max)
      ) {
        problems.push({ field: field.key, code: 'outOfRange' });
      }
    } else if (field.type === 'select') {
      if (!field.options?.some((option) => option.value === String(value))) {
        problems.push({ field: field.key, code: 'invalidOption' });
      }
    } else if (field.pattern !== undefined && typeof value === 'string') {
      if (!new RegExp(`^(?:${field.pattern})$`).test(value)) {
        problems.push({ field: field.key, code: 'invalidFormat' });
      }
    }
  }
  return problems;
}

/** The keys a plugin stores sealed. */
export function secretKeys(fields: readonly FieldDescriptor[]): string[] {
  return fields.filter((field) => field.secret).map((field) => field.key);
}
