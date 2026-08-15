import type { BudgetLimit, BudgetUsage } from '@alphalab/contracts';
import { DomainError } from './errors.js';

export type BudgetRequest = Partial<BudgetUsage>;

const dimensions = [
  'wallClockSeconds',
  'modelCalls',
  'tokens',
  'experiments',
  'computeMilliUnits',
  'activeChildren',
] as const;

export function emptyBudgetUsage(): BudgetUsage {
  return {
    wallClockSeconds: 0,
    modelCalls: 0,
    tokens: 0,
    experiments: 0,
    computeMilliUnits: 0,
    activeChildren: 0,
  };
}

export function reserveBudget(
  limit: BudgetLimit,
  current: BudgetUsage,
  request: BudgetRequest,
): BudgetUsage {
  const next = { ...current };
  for (const dimension of dimensions) {
    const amount = request[dimension] ?? 0;
    if (!Number.isInteger(amount) || amount < 0) {
      throw new DomainError(
        'INVALID_BUDGET_REQUEST',
        `${dimension} must be a non-negative integer`,
      );
    }
    next[dimension] += amount;
  }

  const violations = [
    ['wallClockSeconds', next.wallClockSeconds, limit.wallClockSeconds],
    ['modelCalls', next.modelCalls, limit.modelCalls],
    ['tokens', next.tokens, limit.tokens],
    ['experiments', next.experiments, limit.experiments],
    ['computeMilliUnits', next.computeMilliUnits, limit.computeMilliUnits],
    ['activeChildren', next.activeChildren, limit.parallelChildren],
  ].filter(([, value, maximum]) => Number(value) > Number(maximum));

  if (violations.length > 0) {
    throw new DomainError('BUDGET_EXHAUSTED', 'The requested work exceeds the campaign budget', {
      violations,
    });
  }

  return next;
}

export function reconcileBudget(
  reserved: BudgetUsage,
  reservation: BudgetRequest,
  actual: BudgetRequest,
): BudgetUsage {
  const reconciled = { ...reserved };
  for (const dimension of dimensions) {
    const held = reservation[dimension] ?? 0;
    const consumed = actual[dimension] ?? 0;
    if (!Number.isInteger(consumed) || consumed < 0) {
      throw new DomainError('INVALID_BUDGET_USAGE', `${dimension} must be a non-negative integer`);
    }
    reconciled[dimension] = Math.max(0, reconciled[dimension] - held + consumed);
  }
  return reconciled;
}
