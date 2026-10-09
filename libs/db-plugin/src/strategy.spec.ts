import type { DatabasePlugin } from './plugin';
import { planTransfer } from './strategy';

function plugin(
  id: string,
  format: string,
  overrides: Partial<DatabasePlugin['capabilities']> = {},
  interchange = false,
): DatabasePlugin {
  return {
    id,
    dumpFormat: format,
    capabilities: {
      canBeSource: true,
      canBeTarget: true,
      multipleDatabases: false,
      dockerDiscovery: false,
      ...overrides,
    },
    ...(interchange ? { interchange: {} as never } : {}),
  } as DatabasePlugin;
}

describe('planTransfer', () => {
  it('copies natively between the same dump format', () => {
    expect(planTransfer(plugin('a', 'f'), plugin('a', 'f'))).toEqual({
      kind: 'native',
      format: 'f',
    });
  });

  it('refuses unequal types until both offer the interchange form', () => {
    expect(planTransfer(plugin('a', 'f'), plugin('b', 'g'))).toEqual({
      kind: 'unsupported',
      reason: 'crossEngineUnavailable',
    });
    expect(
      planTransfer(plugin('a', 'f', {}, true), plugin('b', 'g', {}, true)),
    ).toEqual({ kind: 'interchange' });
  });

  it('respects the source/target capabilities', () => {
    expect(
      planTransfer(plugin('a', 'f', { canBeSource: false }), plugin('a', 'f')),
    ).toEqual({ kind: 'unsupported', reason: 'sourceCannotBeSource' });
    expect(
      planTransfer(plugin('a', 'f'), plugin('a', 'f', { canBeTarget: false })),
    ).toEqual({ kind: 'unsupported', reason: 'targetCannotBeTarget' });
  });
});
