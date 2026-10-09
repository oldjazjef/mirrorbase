import type { DatabasePlugin } from './plugin';

/**
 * How data gets from one plugin to another.
 *   native       — the source's own dump is restored by the target (same format). Phase 1.
 *   interchange  — read through the neutral schema/row form (different types). Needs both
 *                  plugins to provide `interchange`; no plugin does yet.
 *   unsupported  — with the reason, for the user and the log.
 */
export type TransferPlan =
  | { readonly kind: 'native'; readonly format: string }
  | { readonly kind: 'interchange' }
  | {
      readonly kind: 'unsupported';
      readonly reason:
        | 'sourceCannotBeSource'
        | 'targetCannotBeTarget'
        | 'crossEngineUnavailable';
    };

export function planTransfer(
  source: DatabasePlugin,
  target: DatabasePlugin,
): TransferPlan {
  if (!source.capabilities.canBeSource) {
    return { kind: 'unsupported', reason: 'sourceCannotBeSource' };
  }
  if (!target.capabilities.canBeTarget) {
    return { kind: 'unsupported', reason: 'targetCannotBeTarget' };
  }
  if (source.dumpFormat === target.dumpFormat) {
    return { kind: 'native', format: source.dumpFormat };
  }
  if (source.interchange && target.interchange) return { kind: 'interchange' };
  return { kind: 'unsupported', reason: 'crossEngineUnavailable' };
}
