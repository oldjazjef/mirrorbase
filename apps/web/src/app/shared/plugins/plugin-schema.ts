import { z } from 'zod';
import type { FieldDescriptor, FieldValue } from '../../core/api/api.types';

/** Longest connection name (the API checks the same). */
export const NAME_MAX = 80;

export interface SchemaOptions {
  /** Secret fields that already have a saved value - leaving them blank keeps it. */
  readonly savedSecrets?: readonly string[];
}

/**
 * The Zod schema of a connection form, built from what a database plugin declares. Zod is the
 * single source of truth for the form's validation (messages are i18n keys); the API validates
 * again with the plugin itself, so this only has to be good enough to catch typos early.
 *
 * Every control holds a string (a boolean for `boolean` fields), including numbers: an empty
 * number field is "not set" and a half-typed one is an error, which a `number` control cannot say.
 */
export function pluginFormSchema(
  fields: readonly FieldDescriptor[],
  options: SchemaOptions = {},
) {
  const shape: Record<string, z.ZodType> = {
    name: z
      .string()
      .trim()
      .min(1, 'validation.required')
      .max(NAME_MAX, 'validation.tooLong'),
  };
  for (const field of fields) shape[field.key] = fieldSchema(field, options);
  return z.object(shape);
}

function fieldSchema(
  field: FieldDescriptor,
  options: SchemaOptions,
): z.ZodType {
  if (field.type === 'boolean') return z.boolean();

  const keepsSaved = field.secret && options.savedSecrets?.includes(field.key);
  const required =
    field.required === true && !keepsSaved && field.default === undefined;

  return z.string().superRefine((raw, context) => {
    const value = raw.trim();
    if (value === '') {
      if (required)
        context.addIssue({ code: 'custom', message: 'validation.required' });
      return;
    }
    if (field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        context.addIssue({ code: 'custom', message: 'validation.number' });
      } else if (
        (field.min !== undefined && number < field.min) ||
        (field.max !== undefined && number > field.max)
      ) {
        context.addIssue({ code: 'custom', message: 'validation.range' });
      }
    } else if (field.type === 'select') {
      if (!field.options?.some((option) => option.value === value)) {
        context.addIssue({ code: 'custom', message: 'validation.option' });
      }
    }
  });
}

/** The initial control values: saved settings over the plugin's defaults. */
export function initialValues(
  fields: readonly FieldDescriptor[],
  config: Readonly<Record<string, FieldValue | undefined>> = {},
  name = '',
): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = { name };
  for (const field of fields) {
    if (field.secret) {
      values[field.key] = '';
    } else if (field.type === 'boolean') {
      values[field.key] = Boolean(config[field.key] ?? field.default ?? false);
    } else {
      const saved = config[field.key];
      values[field.key] = saved !== undefined ? String(saved) : '';
    }
  }
  return values;
}

/**
 * Form values → what the API takes. Blank fields are left out (the plugin applies its default),
 * numbers become numbers, a blank password is "not typed" (the saved one stays).
 */
export function toPayload(
  fields: readonly FieldDescriptor[],
  values: Readonly<Record<string, unknown>>,
): { config: Record<string, FieldValue>; secrets: Record<string, string> } {
  const config: Record<string, FieldValue> = {};
  const secrets: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (field.type === 'boolean') {
      config[field.key] = raw === true;
      continue;
    }
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (field.secret) {
      // Passwords are not trimmed: spaces may be part of one.
      if (typeof raw === 'string' && raw.length > 0) secrets[field.key] = raw;
    } else if (text !== '') {
      config[field.key] = field.type === 'number' ? Number(text) : text;
    }
  }
  return { config, secrets };
}

/** Defaults shown as placeholders so a blank field says what it will be. */
export function placeholderOf(field: FieldDescriptor): string | undefined {
  if (field.placeholder) return field.placeholder;
  return field.default !== undefined && field.type !== 'select'
    ? String(field.default)
    : undefined;
}
