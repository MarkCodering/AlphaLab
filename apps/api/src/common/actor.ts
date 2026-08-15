import { BadRequestException } from '@nestjs/common';
import { ActorSchema, type Actor } from '@alphalab/contracts';

export function actorFromHeaders(
  actorId: string | undefined,
  actorRole: string | undefined,
): Actor {
  const parsed = ActorSchema.safeParse({
    type: actorRole === 'SYSTEM_SERVICE' ? 'SERVICE' : 'USER',
    id: actorId,
    role: actorRole,
  });
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'ACTOR_HEADERS_INVALID',
      message: 'x-actor-id and x-actor-role headers are required and must be valid',
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 8) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'idempotency-key must contain at least eight characters',
    });
  }
  return value;
}

export function requireExpectedVersion(value: string | undefined): number {
  if (!value) {
    throw new BadRequestException({
      code: 'EXPECTED_VERSION_REQUIRED',
      message: 'if-match is required for campaign transitions',
    });
  }
  const normalized = value.replaceAll('"', '').replace(/^W\//, '');
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException({
      code: 'EXPECTED_VERSION_INVALID',
      message: 'if-match must be a non-negative campaign state version',
    });
  }
  return parsed;
}
