import { describe, expect, it } from 'vitest';
import { createLogRecord, redactFields } from './index';

describe('observability boundary', () => {
  it('redacts nested secret-shaped fields', () => {
    expect(redactFields({ apiKey: 'secret', nested: { authorization: 'bearer x', ok: 1 } })).toEqual({
      apiKey: '[REDACTED]',
      nested: { authorization: '[REDACTED]', ok: 1 },
    });
  });

  it('keeps trace and campaign correlation identifiers', () => {
    const record = createLogRecord(
      'worker',
      'workflow.checkpointed',
      'Checkpoint stored',
      { traceId: 'trace-1', spanId: 'span-1', campaignId: 'campaign-1' },
      {},
    );
    expect(record).toMatchObject({ traceId: 'trace-1', campaignId: 'campaign-1' });
  });
});
