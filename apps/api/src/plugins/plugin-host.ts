import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type CommandResult,
  type CommandSpec,
  type HostContext,
  type LogLevel,
  redactConnectionStrings,
  redactSecrets,
} from '@mirrorbase/db-plugin';
import type { Env } from '../config/env';
import { runProcess } from '../integrations/process/run-process';
import { type LogWriter, LogService } from '../logs/log.service';

export interface RunHost {
  readonly host: HostContext;
  readonly log: LogWriter;
  /** Removes the work directories and flushes the log. Always call it, in a `finally`. */
  dispose(): Promise<void>;
}

export interface RunHostOptions {
  /** The run the log lines belong to; null for a one-off (a connection test). */
  readonly runId: string | null;
  /** Passwords to blank out of everything logged. */
  readonly secrets: readonly string[];
  readonly signal?: AbortSignal;
}

/** The last stderr lines logged when a command fails. */
const STDERR_TAIL_LINES = 10;

/**
 * Builds the `HostContext` a plugin works through: real processes, a private work directory, and
 * a log that redacts. This - with run-process.ts - is where "a plugin asks the machine to do
 * something" becomes actual process spawning.
 */
@Injectable()
export class PluginHostFactory {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly logs: LogService,
  ) {}

  create(options: RunHostOptions): RunHost {
    const log = this.logs.writer(options.runId, options.secrets);
    const directories: string[] = [];
    const root =
      this.config.get('WORK_DIR', { infer: true }) ||
      join(tmpdir(), 'mirrorbase');
    const uid = process.getuid?.();
    const gid = process.getgid?.();

    const host: HostContext = {
      platform: process.platform,
      ...(uid !== undefined && gid !== undefined
        ? { runAsUser: `${uid}:${gid}` }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      log: (level: LogLevel, message: string) => log.write(level, message),
      run: async (spec: CommandSpec): Promise<CommandResult> => {
        const secrets = [...options.secrets, ...(spec.secrets ?? [])];
        if (spec.logCommand !== false) {
          const line = [spec.command, ...spec.args].join(' ');
          log.write(
            'debug',
            `$ ${redactConnectionStrings(redactSecrets(line, secrets))}`,
          );
        }
        const result = await runProcess({
          command: spec.command,
          args: spec.args,
          ...(spec.env ? { env: spec.env } : {}),
          ...(spec.timeoutMs !== undefined
            ? { timeoutMs: spec.timeoutMs }
            : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (result.exitCode !== 0 && spec.logCommand !== false) {
          const tail = result.stderr
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0)
            .slice(-STDERR_TAIL_LINES);
          for (const line of tail) log.write('warn', line);
          if (result.failure === 'timeout')
            log.write('error', `${spec.command} timed out`);
        }
        return result;
      },
      workDir: async (): Promise<string> => {
        await mkdir(root, { recursive: true, mode: 0o700 });
        // mkdtemp creates the directory with mode 0700: dump files hold a whole database in
        // plain text and must not be readable by other users of the machine.
        const directory = await mkdtemp(join(root, 'run-'));
        directories.push(directory);
        return directory;
      },
    };

    return {
      host,
      log,
      dispose: async () => {
        await Promise.all(
          directories.map((directory) =>
            rm(directory, { recursive: true, force: true }),
          ),
        );
        await log.flush();
      },
    };
  }
}
