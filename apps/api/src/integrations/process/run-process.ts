import { spawn } from 'node:child_process';
import type { CommandResult } from '@dbreplicator/db-plugin';

/** Output beyond this is dropped (the head is kept): a pg_dump to stdout must not eat the heap. */
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
/** How long a terminated process gets before it is killed outright. */
const KILL_GRACE_MS = 5_000;

export interface RunProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Called for every complete line of stderr as it arrives (progress, warnings). */
  readonly onStderrLine?: (line: string) => void;
}

/**
 * Runs a process without a shell - arguments are passed as an array, so nothing in them is ever
 * interpreted - and never rejects: a missing program, a timeout or a cancel are in the result.
 * The one place that spawns processes besides the docker adapter (see eslint.config.mjs).
 */
export function runProcess(options: RunProcessOptions): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let stderrTail = '';
    let failure: CommandResult['failure'];
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      if (stderrTail.length > 0) options.onStderrLine?.(stderrTail);
      resolve({
        exitCode,
        stdout,
        stderr,
        ...(failure ? { failure } : {}),
      });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(options.command, [...options.args], {
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch {
      failure = 'spawn';
      finish(-1);
      return;
    }

    const terminate = (reason: 'timeout' | 'aborted'): void => {
      failure ??= reason;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    };
    const onAbort = (): void => terminate('aborted');

    if (options.signal?.aborted) {
      terminate('aborted');
    } else {
      options.signal?.addEventListener('abort', onAbort, { once: true });
    }
    if (options.timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => terminate('timeout'), options.timeoutMs);
    }

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk;
      if (!options.onStderrLine) return;
      stderrTail += chunk;
      const lines = stderrTail.split(/\r?\n/);
      stderrTail = lines.pop() ?? '';
      for (const line of lines) if (line.length > 0) options.onStderrLine(line);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      failure ??= error.code === 'ENOENT' ? 'notFound' : 'spawn';
      finish(-1);
    });
    child.on('close', (code) => finish(code ?? -1));
  });
}
