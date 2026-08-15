import type { CampaignRecord } from './types';

export const setupSequence = [
  'DRAFT',
  'TARGET_REVIEW',
  'READY_FOR_ROUTE',
  'ROUTE_REVIEW',
  'READY',
] as const;

const activeStatuses = new Set([
  'RUNNING',
  'WAITING_FOR_APPROVAL',
  'RUNNING_EXPERIMENT',
  'VERIFYING',
]);

export function campaignTone(
  status: CampaignRecord['status'],
): 'active' | 'warn' | 'done' | 'idle' {
  if (activeStatuses.has(status)) return 'active';
  if (['VERIFIED', 'DISCOVERY_CANDIDATE'].includes(status)) return 'done';
  if (['WAITING_FOR_APPROVAL', 'NEEDS_HUMAN', 'BLOCKED', 'UNSAFE', 'FAILED'].includes(status))
    return 'warn';
  return 'idle';
}

export function budgetPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function shortId(id: string): string {
  const suffix = id.split('_').at(-1) ?? id;
  return suffix.slice(0, 8).toUpperCase();
}
