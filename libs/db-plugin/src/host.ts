/**
 * What a plugin may ask of the machine it runs on. The API hands in the real implementation
 * (child processes, the log); specs hand in a fake. A plugin never imports `node:child_process`.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface CommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  /**
   * Added to the process environment. Secrets travel HERE (`PGPASSWORD`), never in `args`:
   * arguments are visible to every process on the machine and end up in logs.
   */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** Values to blank out of everything this command logs (passwords). */
  readonly secrets?: readonly string[];
  /** Log the command line? Off for commands whose arguments are noise. Default true. */
  readonly logCommand?: boolean;
}

export interface CommandResult {
  /** `-1` when the process could not be started or was killed. */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Why it could not start (`ENOENT`, `timeout`, `aborted`). */
  readonly failure?: 'notFound' | 'timeout' | 'aborted' | 'spawn';
}

/** What a plugin may ask of a cancel signal: "has the person stopped this run?" */
export interface CancelSignal {
  readonly aborted: boolean;
}

export interface HostContext {
  /** `process.platform` of the machine. */
  readonly platform: string;
  /**
   * `uid:gid` of the current user on POSIX, `undefined` on Windows. A container writing into a
   * mounted work directory runs as this user, or the files it creates (and the directory's
   * private permissions) would not match.
   */
  readonly runAsUser?: string;
  /** Set when the user cancels the run. */
  readonly signal?: CancelSignal;
  /** Runs a process and waits. Never rejects: failures are in the result. */
  run(spec: CommandSpec): Promise<CommandResult>;
  /** A message in the run's log. */
  log(level: LogLevel, message: string): void;
  /** A fresh, empty directory for dump files; removed by the host when the run ends. */
  workDir(): Promise<string>;
}
