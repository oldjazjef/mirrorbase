import { redactConnectionStrings, redactSecrets } from './redact';

describe('redact', () => {
  it('blanks known secrets, longest first', () => {
    expect(redactSecrets('pw=hunter2 and hunter', ['hunter', 'hunter2'])).toBe(
      'pw=*** and ***',
    );
  });

  it('ignores very short secrets', () => {
    expect(redactSecrets('a1b', ['1'])).toBe('a1b');
  });

  it('blanks passwords in connection strings', () => {
    expect(
      redactConnectionStrings('postgresql://bob:s3cret@host/db password=abc'),
    ).toBe('postgresql://bob:***@host/db password=***');
  });
});
