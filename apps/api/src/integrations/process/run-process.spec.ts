import { runProcess } from './run-process';

const node = process.execPath;

describe('runProcess', () => {
  it('captures output and the exit code', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', "console.log('out'); console.error('err'); process.exit(3)"],
    });
    expect(result).toMatchObject({
      exitCode: 3,
      stdout: 'out\n',
      stderr: 'err\n',
    });
    expect(result.failure).toBeUndefined();
  });

  it('passes arguments verbatim, never through a shell', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', 'console.log(process.argv[1])', '$(echo pwned); `x` && y'],
    });
    expect(result.stdout.trim()).toBe('$(echo pwned); `x` && y');
  });

  it('hands the environment to the process', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', 'console.log(process.env.MB_TEST)'],
      env: { MB_TEST: 'secret-value' },
    });
    expect(result.stdout.trim()).toBe('secret-value');
  });

  it('reports a missing program as notFound instead of rejecting', async () => {
    expect(
      await runProcess({ command: 'definitely-not-a-program-xyz', args: [] }),
    ).toMatchObject({ exitCode: -1, failure: 'notFound' });
  });

  it('stops a process that runs too long', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 150,
    });
    expect(result.failure).toBe('timeout');
  });

  it('stops a process when the run is cancelled', async () => {
    const controller = new AbortController();
    const pending = runProcess({
      command: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    expect((await pending).failure).toBe('aborted');
  });

  it('streams stderr lines as they complete', async () => {
    const lines: string[] = [];
    await runProcess({
      command: node,
      args: ['-e', "process.stderr.write('a\\nb\\nc')"],
      onStderrLine: (line) => lines.push(line),
    });
    expect(lines).toEqual(['a', 'b', 'c']);
  });
});
