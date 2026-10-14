import {
  decryptEnvelope,
  encryptEnvelope,
  WrongExportPasswordError,
} from './export-envelope';

describe('export envelope', () => {
  it('round-trips and never contains the plain text', () => {
    const envelope = encryptEnvelope(
      '{"secret":"hunter2-hunter2"}',
      'pw-12345678',
    );
    expect(JSON.stringify(envelope)).not.toContain('hunter2');
    expect(decryptEnvelope(envelope, 'pw-12345678')).toBe(
      '{"secret":"hunter2-hunter2"}',
    );
  });

  it('uses a fresh salt and IV every time', () => {
    const a = encryptEnvelope('x', 'pw-12345678');
    const b = encryptEnvelope('x', 'pw-12345678');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('refuses a wrong password and a changed file', () => {
    const envelope = encryptEnvelope('payload', 'pw-12345678');
    expect(() => decryptEnvelope(envelope, 'other-password')).toThrow(
      WrongExportPasswordError,
    );
    const changed = {
      ...envelope,
      data: Buffer.from('tampered').toString('base64'),
    };
    expect(() => decryptEnvelope(changed, 'pw-12345678')).toThrow(
      WrongExportPasswordError,
    );
  });
});
