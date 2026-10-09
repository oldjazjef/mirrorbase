import { Logger } from '@nestjs/common';
import { InMemoryLogRepository as InMemoryLog } from './testing/in-memory-log.repository';
import { LogService } from './log.service';

describe('LogService', () => {
  it('keeps the order of lines and flushes them', async () => {
    const repository = new InMemoryLog();
    const writer = new LogService(repository).writer('run-1');
    writer.write('info', 'one');
    writer.write('warn', 'two');
    writer.write('error', 'three');
    await writer.flush();
    expect(repository.entries.map((row) => row.message)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(repository.entries.every((row) => row.runId === 'run-1')).toBe(true);
  });

  it('never stores a known password or a password in a connection string', async () => {
    const repository = new InMemoryLog();
    const writer = new LogService(repository).writer(null, ['hunter2!']);
    writer.write(
      'error',
      'FATAL: password hunter2! rejected for postgres://bob:hunter2!@db/x',
    );
    await writer.flush();
    const stored = repository.entries[0]!.message;
    expect(stored).not.toContain('hunter2!');
    expect(stored).toContain('***');
  });

  it('cuts very long messages', async () => {
    const repository = new InMemoryLog();
    const writer = new LogService(repository).writer(null);
    writer.write('info', 'x'.repeat(10_000));
    await writer.flush();
    expect(repository.entries[0]!.message.length).toBeLessThan(4_100);
  });

  it('survives a failing store', async () => {
    const failing = new InMemoryLog();
    failing.append = () => Promise.reject(new Error('disk full'));
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const writer = new LogService(failing).writer(null);
    writer.write('info', 'x');
    await expect(writer.flush()).resolves.toBeUndefined();
  });
});
