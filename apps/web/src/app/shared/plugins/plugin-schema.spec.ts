import type { FieldDescriptor } from '../../core/api/api.types';
import { initialValues, pluginFormSchema, toPayload } from './plugin-schema';

const FIELDS: FieldDescriptor[] = [
  { key: 'host', type: 'text', label: { en: 'Host' }, required: true },
  {
    key: 'port',
    type: 'number',
    label: { en: 'Port' },
    default: 5432,
    min: 1,
    max: 65535,
  },
  {
    key: 'user',
    type: 'text',
    label: { en: 'User' },
    required: true,
    default: 'postgres',
  },
  {
    key: 'password',
    type: 'password',
    secret: true,
    label: { en: 'Password' },
    required: true,
  },
  {
    key: 'ssl',
    type: 'select',
    label: { en: 'SSL' },
    default: 'prefer',
    options: [
      { value: 'prefer', label: { en: 'Prefer' } },
      { value: 'require', label: { en: 'Require' } },
    ],
  },
  { key: 'verify', type: 'boolean', label: { en: 'Verify' } },
];

const valid = {
  name: 'Prod',
  host: 'db',
  port: '',
  user: '',
  password: 'x',
  ssl: '',
  verify: false,
};

function messages(
  values: Record<string, unknown>,
  options = {},
): Record<string, string> {
  const result = pluginFormSchema(FIELDS, options).safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((i) => [String(i.path[0]), i.message]),
  );
}

describe('pluginFormSchema', () => {
  it('accepts a complete form and treats a defaulted field as optional', () => {
    expect(messages(valid)).toEqual({});
  });

  it('asks for the name and the required fields', () => {
    expect(messages({ ...valid, name: '  ', host: '', password: '' })).toEqual({
      name: 'validation.required',
      host: 'validation.required',
      password: 'validation.required',
    });
  });

  it('lets a saved password stay when the field is left blank', () => {
    expect(
      messages({ ...valid, password: '' }, { savedSecrets: ['password'] }),
    ).toEqual({});
  });

  it('checks numbers, ranges and options', () => {
    expect(messages({ ...valid, port: 'abc' })).toEqual({
      port: 'validation.number',
    });
    expect(messages({ ...valid, port: '70000' })).toEqual({
      port: 'validation.range',
    });
    expect(messages({ ...valid, ssl: 'bogus' })).toEqual({
      ssl: 'validation.option',
    });
  });

  it('limits the name length', () => {
    expect(messages({ ...valid, name: 'x'.repeat(81) })).toEqual({
      name: 'validation.tooLong',
    });
  });
});

describe('toPayload', () => {
  it('splits settings from passwords, types numbers and drops blanks', () => {
    expect(
      toPayload(FIELDS, {
        ...valid,
        port: ' 5433 ',
        password: ' p w ',
        verify: true,
      }),
    ).toEqual({
      config: { host: 'db', port: 5433, verify: true },
      secrets: { password: ' p w ' },
    });
  });

  it('does not send a blank password, so a saved one stays', () => {
    expect(toPayload(FIELDS, { ...valid, password: '' }).secrets).toEqual({});
  });
});

describe('initialValues', () => {
  it('prefills saved settings, leaves passwords blank and keeps booleans', () => {
    expect(
      initialValues(FIELDS, { host: 'h', port: 5433, verify: true }, 'Prod'),
    ).toEqual({
      name: 'Prod',
      host: 'h',
      port: '5433',
      user: '',
      password: '',
      ssl: '',
      verify: true,
    });
  });
});
