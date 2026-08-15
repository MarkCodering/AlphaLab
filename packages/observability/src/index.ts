export interface TraceContext {
  traceId: string;
  spanId: string;
  correlationId?: string;
  causationId?: string;
  organizationId?: string;
  projectId?: string;
  campaignId?: string;
  runId?: string;
}

export interface StructuredLogRecord extends TraceContext {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  event: string;
  message: string;
  fields: Record<string, unknown>;
}

const secretKeyPattern = /(authorization|cookie|password|secret|token|credential|api[-_]?key)/i;

export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      secretKeyPattern.test(key)
        ? '[REDACTED]'
        : value && typeof value === 'object' && !Array.isArray(value)
          ? redactFields(value as Record<string, unknown>)
          : value,
    ]),
  );
}

export function createLogRecord(
  service: string,
  event: string,
  message: string,
  trace: TraceContext,
  fields: Record<string, unknown> = {},
  level: StructuredLogRecord['level'] = 'info',
): StructuredLogRecord {
  return {
    timestamp: new Date().toISOString(),
    level,
    service,
    event,
    message,
    ...trace,
    fields: redactFields(fields),
  };
}

export const metricNames = {
  controlRequestDuration: 'alphalab_control_request_duration_seconds',
  campaignTransitions: 'alphalab_campaign_transitions_total',
  budgetReserved: 'alphalab_budget_reserved_total',
  modelRequests: 'alphalab_model_requests_total',
  experimentRuns: 'alphalab_experiment_runs_total',
  approvalWaitSeconds: 'alphalab_approval_wait_seconds',
  verificationOutcomes: 'alphalab_verification_outcomes_total',
} as const;
