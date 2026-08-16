import { z } from 'zod';
import { ContractVersionSchema, IdentifierSchema, TimestampSchema } from './common.js';

export const ProjectMemberRoleSchema = z.enum([
  'OWNER',
  'RESEARCHER',
  'SCIENTIFIC_REVIEWER',
  'VIEWER',
]);
export type ProjectMemberRole = z.infer<typeof ProjectMemberRoleSchema>;

export const ProjectMemberSchema = z.object({
  contractVersion: ContractVersionSchema,
  projectId: IdentifierSchema,
  organizationId: IdentifierSchema,
  actorId: IdentifierSchema,
  role: ProjectMemberRoleSchema,
  createdAt: TimestampSchema,
  createdBy: IdentifierSchema,
});
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;

export const ProjectMemberGrantSchema = ProjectMemberSchema.pick({
  actorId: true,
  role: true,
}).refine((member) => member.role !== 'OWNER', {
  message: 'Project ownership is assigned only when a project is created',
  path: ['role'],
});
export type ProjectMemberGrant = z.infer<typeof ProjectMemberGrantSchema>;
