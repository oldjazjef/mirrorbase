const MASK = '***';

/**
 * Blanks every secret out of `text`. Used on everything that reaches the log: command lines,
 * tool output, error messages. Secrets shorter than 3 characters are skipped — masking "1" would
 * shred the log without protecting anything.
 */
export function redactSecrets(
  text: string,
  secrets: readonly string[],
): string {
  let result = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length < 3) continue;
    result = result.split(secret).join(MASK);
  }
  return result;
}

/** `host=… password=…` style and URL passwords, for text that did not come from a known secret. */
export function redactConnectionStrings(text: string): string {
  return text
    .replace(/(password\s*=\s*)('[^']*'|\S+)/gi, `$1${MASK}`)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:/@\s]+:)[^@\s]+(@)/gi, `$1${MASK}$2`);
}
