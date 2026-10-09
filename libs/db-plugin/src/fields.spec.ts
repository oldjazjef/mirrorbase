import { type FieldDescriptor, secretKeys, validateFields } from './fields';

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
    key: 'mode',
    type: 'select',
    label: { en: 'Mode' },
    options: [{ value: 'a', label: { en: 'A' } }],
  },
  { key: 'password', type: 'password', label: { en: 'PW' }, secret: true },
];

describe('validateFields', () => {
  it('reports a missing required field and accepts defaults', () => {
    expect(validateFields(FIELDS, { config: {}, secrets: {} })).toEqual([
      { field: 'host', code: 'required' },
    ]);
  });

  it('checks numbers, ranges and options', () => {
    const problems = validateFields(FIELDS, {
      config: { host: 'h', port: 70000, mode: 'zzz' },
      secrets: {},
    });
    expect(problems).toEqual([
      { field: 'port', code: 'outOfRange' },
      { field: 'mode', code: 'invalidOption' },
    ]);
    expect(
      validateFields(FIELDS, {
        config: { host: 'h', port: 'abc' },
        secrets: {},
      }),
    ).toContainEqual({ field: 'port', code: 'invalidNumber' });
  });

  it('reads secret fields from the secrets map', () => {
    const required: FieldDescriptor[] = [{ ...FIELDS[3]!, required: true }];
    expect(validateFields(required, { config: {}, secrets: {} })).toHaveLength(
      1,
    );
    expect(
      validateFields(required, { config: {}, secrets: { password: 'x' } }),
    ).toEqual([]);
  });

  it('lists the secret keys', () => {
    expect(secretKeys(FIELDS)).toEqual(['password']);
  });
});
