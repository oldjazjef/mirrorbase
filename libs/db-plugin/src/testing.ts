import type { CommandResult, CommandSpec, HostContext, LogLevel } from './host';

export interface FakeHost extends HostContext {
  readonly commands: CommandSpec[];
  readonly logs: { level: LogLevel; message: string }[];
}

type Responder = (spec: CommandSpec) => Partial<CommandResult> | undefined;

/**
 * A `HostContext` for plugin specs: records every command and answers from `respond` (default:
 * exit 0, no output). Lives in the contract lib so every plugin tests the same way.
 */
export function createFakeHost(
  respond: Responder = () => undefined,
  options: { platform?: string; workDir?: string; runAsUser?: string } = {},
): FakeHost {
  const commands: CommandSpec[] = [];
  const logs: { level: LogLevel; message: string }[] = [];
  return {
    platform: options.platform ?? 'linux',
    ...(options.runAsUser ? { runAsUser: options.runAsUser } : {}),
    commands,
    logs,
    run(spec) {
      commands.push(spec);
      const answer = respond(spec) ?? {};
      return Promise.resolve({
        exitCode: 0,
        stdout: '',
        stderr: '',
        ...answer,
      });
    },
    log(level, message) {
      logs.push({ level, message });
    },
    workDir() {
      return Promise.resolve(options.workDir ?? '/tmp/fake-work');
    },
  };
}
