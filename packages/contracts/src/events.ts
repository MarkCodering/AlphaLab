import { z } from 'zod';
import { ActorSchema, ContractVersionSchema, IdentifierSchema, TimestampSchema } from './common.js';

export const DomainEventSchema = z.object({
  contractVersion: ContractVersionSchema,
  eventId: IdentifierSchema,
  eventType: z.string().min(3),
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  campaignId: IdentifierSchema.optional(),
  runId: IdentifierSchema.optional(),
  targetVersionId: IdentifierSchema.optional(),
  correlationId: IdentifierSchema,
  causationId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  actor: ActorSchema,
  occurredAt: TimestampSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;
