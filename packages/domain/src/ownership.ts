export type OwnershipAuthority =
  | 'current_active'
  | 'foreign_active'
  | 'stale_reclaimable'
  | 'ownerless_adoptable'
  | 'unverified'
  | 'released';

export type JanitorAction =
  | 'destructive_cleanup'
  | 'keep'
  | 'block';

export interface OwnershipDecision<TReason extends string = string> {
  authority: OwnershipAuthority;
  reason: TReason;
}

export interface JanitorDecision<TReason extends string = string> extends OwnershipDecision<TReason> {
  action: JanitorAction;
}

export function authorityAllowsDestructiveCleanup(authority: OwnershipAuthority): boolean {
  return authority === 'stale_reclaimable'
    || authority === 'ownerless_adoptable'
    || authority === 'released';
}

export function isDestructiveJanitorAction(action: JanitorAction): boolean {
  return action === 'destructive_cleanup';
}

export function buildJanitorDecision<TReason extends string>(
  decision: OwnershipDecision<TReason>,
): JanitorDecision<TReason> {
  switch (decision.authority) {
    case 'stale_reclaimable':
    case 'ownerless_adoptable':
    case 'released':
      return {
        ...decision,
        action: 'destructive_cleanup',
      };
    case 'current_active':
    case 'foreign_active':
      return {
        ...decision,
        action: 'keep',
      };
    case 'unverified':
      return {
        ...decision,
        action: 'block',
      };
  }
}
