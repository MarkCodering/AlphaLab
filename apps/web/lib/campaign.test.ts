import { describe, expect, it } from 'vitest';
import { budgetPercent, campaignTone, shortId } from './campaign';

describe('campaign presentation predicates', () => {
  it('never renders budget usage above one hundred percent', () => {
    expect(budgetPercent(12, 10)).toBe(100);
    expect(budgetPercent(0, 0)).toBe(0);
  });

  it('makes human gates and unsafe states visually urgent', () => {
    expect(campaignTone('WAITING_FOR_APPROVAL')).toBe('active');
    expect(campaignTone('UNSAFE')).toBe('warn');
    expect(campaignTone('VERIFIED')).toBe('done');
  });

  it('uses stable compact identifiers', () => {
    expect(shortId('cmp_1234567890')).toBe('12345678');
  });
});
