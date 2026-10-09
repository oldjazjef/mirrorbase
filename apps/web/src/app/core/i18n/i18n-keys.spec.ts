// @vitest-environment node
// Reads source and message files from disk; no DOM involved.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_ERROR_CODES, HTTP_STATUS_NAMES } from '../api/api-error';
import {
  DATABASE_STATUSES,
  DOCKER_REASONS,
  LOG_LEVELS,
  RUN_STATUSES,
  TRANSFER_REASONS,
} from '../api/api.types';
import { allHelpKeys } from '../../features/help/help-content';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './locales';

/**
 * Every i18n key the app references exists in every message file. A missing key renders as its
 * raw path (`connections.title`) - invisible in review, obvious to people.
 *
 * Keys are found as quoted dotted literals. Keys assembled at runtime are listed explicitly.
 */
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const I18N_DIR = fileURLToPath(
  new URL('../../../../public/i18n', import.meta.url),
);

const DYNAMIC_KEYS = [
  ...allHelpKeys(),
  ...RUN_STATUSES.map((status) => `runs.status.${status}`),
  ...DATABASE_STATUSES.map((status) => `runs.dbStatus.${status}`),
  ...LOG_LEVELS.map((level) => `log.levels.${level}`),
  ...DOCKER_REASONS.map((reason) => `docker.unavailable.${reason}`),
  ...TRANSFER_REASONS.map((reason) => `replicate.plan.${reason}`),
  ...API_ERROR_CODES.map((code) => `errors.api.${code}`),
  ...HTTP_STATUS_NAMES.map((name) => `errors.status.${name}`),
  ...['idle', 'system'].map((reason) => `pin.lock.reason.${reason}`),
  ...['source', 'target'].map((side) => `replicate.${side}`),
  ...['os-keychain', 'file'].map(
    (kind) => `settings.about.keyProtection.${kind}`,
  ),
  ...['currentPin', 'pin', 'repeat'].map((field) => `settings.pin.${field}`),
  ...[
    'wrongPin',
    'pinThrottled',
    'noPin',
    'invalidPin',
    'currentPinRequired',
    'confirmationRequired',
    'unreachable',
    'unknown',
  ].map((code) => `pin.errors.${code}`),
];

/** Keys that only exist in specs. */
const SPEC_ONLY = /^(thing|groups|greeting)\./;

/** DatePipe formats look like keys (`'dd.MM.yyyy'`) but are not. */
const DATE_FORMAT = /^[dMyHhms]+(\.[dMyHhms]+)+$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

function referencedKeys(): Set<string> {
  const keys = new Set(DYNAMIC_KEYS);
  const literal = /'([a-z][a-zA-Z]*(?:\.[a-zA-Z-]+)+)'/g;
  for (const file of files(APP_DIR)) {
    for (const [, key] of readFileSync(file, 'utf8').matchAll(literal)) {
      if (
        key &&
        !SPEC_ONLY.test(key) &&
        !DATE_FORMAT.test(key) &&
        !/\.(ts|html|css|json|js|zip)$/.test(key) &&
        // Property paths in templates ('service.plan()') are not keys; keys have a known root.
        KEY_ROOTS.has(key.split('.')[0] ?? '')
      ) {
        keys.add(key);
      }
    }
  }
  return keys;
}

const KEY_ROOTS = new Set([
  'app',
  'common',
  'actions',
  'nav',
  'validation',
  'errors',
  'pin',
  'connections',
  'docker',
  'replicate',
  'runs',
  'log',
  'settings',
  'help',
  'support',
]);

function has(messages: unknown, key: string): boolean {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node))
      return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

function flatten(
  node: unknown,
  prefix = '',
  out = new Map<string, string>(),
): Map<string, string> {
  if (typeof node === 'string') {
    out.set(prefix, node);
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

/** `{{ name }}` placeholders of a text, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
    .map((match) => match[1] ?? '')
    .sort();
}

function messagesOf(locale: string): Map<string, string> {
  return flatten(
    JSON.parse(readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8')),
  );
}

describe('i18n message files', () => {
  const keys = [...referencedKeys()];

  it('finds the keys it is supposed to check', () => {
    expect(keys.length).toBeGreaterThan(60);
  });

  it('has exactly one file per supported locale', () => {
    expect(
      readdirSync(I18N_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace(/\.json$/, ''))
        .sort(),
    ).toEqual([...SUPPORTED_LOCALES].sort());
  });

  const reference = messagesOf(DEFAULT_LOCALE);
  for (const locale of SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
    it(`${locale}.json has the same keys as ${DEFAULT_LOCALE}.json - none missing, none extra`, () => {
      const messages = messagesOf(locale);
      expect([...reference.keys()].filter((key) => !messages.has(key))).toEqual(
        [],
      );
      expect([...messages.keys()].filter((key) => !reference.has(key))).toEqual(
        [],
      );
    });

    it(`${locale}.json keeps every placeholder`, () => {
      const messages = messagesOf(locale);
      const wrong = [...reference].filter(
        ([key, text]) =>
          placeholders(messages.get(key) ?? '').join() !==
          placeholders(text).join(),
      );
      expect(wrong.map(([key]) => key)).toEqual([]);
    });
  }

  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}.json defines every key the app references`, () => {
      const messages = JSON.parse(
        readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8'),
      ) as unknown;
      expect(keys.filter((key) => !has(messages, key)).sort()).toEqual([]);
    });
  }

  it('has no unused keys in the reference file (a deleted feature must take its texts along)', () => {
    const used = new Set(keys);
    const prefixes = [...used].map((key) => `${key}.`);
    const unused = [...reference.keys()].filter(
      (key) =>
        !used.has(key) && !prefixes.some((prefix) => prefix === `${key}.`),
    );
    // Keys read through a runtime-built name (`'x.' + y`) are covered by DYNAMIC_KEYS above.
    expect(unused.sort()).toEqual([]);
  });
});
