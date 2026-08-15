BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  subject text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN (
    'RESEARCHER', 'SCIENTIFIC_REVIEWER', 'ORGANIZATION_ADMIN',
    'INFRASTRUCTURE_OPERATOR'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, subject)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX projects_organization_idx ON projects (organization_id, created_at DESC);

CREATE TABLE targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE target_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  target_id uuid NOT NULL REFERENCES targets(id),
  version integer NOT NULL CHECK (version > 0),
  scientific_goal text NOT NULL,
  research_question text NOT NULL,
  acceptance_criteria jsonb NOT NULL,
  verification_policy_id text NOT NULL,
  stop_conditions jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_id, version)
);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  target_version_id uuid NOT NULL REFERENCES target_versions(id),
  status text NOT NULL,
  resume_status text,
  state_version bigint NOT NULL DEFAULT 0,
  budget_version integer NOT NULL DEFAULT 1,
  budget_limit jsonb NOT NULL,
  budget_usage jsonb NOT NULL,
  workflow_id text UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX campaigns_project_status_idx ON campaigns (project_id, status, updated_at DESC);

CREATE TABLE domain_events (
  sequence bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  campaign_id uuid REFERENCES campaigns(id),
  event_type text NOT NULL,
  schema_version text NOT NULL,
  correlation_id text NOT NULL,
  causation_id text NOT NULL,
  idempotency_key text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (campaign_id, idempotency_key, event_type)
);
CREATE INDEX domain_events_campaign_sequence_idx ON domain_events (campaign_id, sequence);

CREATE TABLE idempotency_records (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  response_status integer,
  response_body jsonb,
  state text NOT NULL CHECK (state IN ('STARTED', 'COMPLETED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, scope, idempotency_key)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  campaign_id uuid REFERENCES campaigns(id),
  action_kind text NOT NULL,
  risk_tier text NOT NULL CHECK (risk_tier IN ('GREEN', 'YELLOW', 'RED')),
  action_digest text NOT NULL CHECK (action_digest ~ '^sha256:[0-9a-f]{64}$'),
  action_payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'DECIDED', 'EXPIRED', 'CANCELLED')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  request_id uuid NOT NULL UNIQUE REFERENCES approval_requests(id),
  action_digest text NOT NULL CHECK (action_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_version text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'REVOKED')),
  decided_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  object_key text NOT NULL,
  retention_status text NOT NULL DEFAULT 'ACTIVE',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, project_id, digest)
);

CREATE TABLE evidence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  run_id text NOT NULL,
  target_version_id uuid NOT NULL REFERENCES target_versions(id),
  record_type text NOT NULL,
  status text NOT NULL,
  statement text NOT NULL,
  source_pointers jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  invalidated_by uuid REFERENCES evidence_records(id)
);
CREATE INDEX evidence_campaign_idx ON evidence_records (campaign_id, created_at);

CREATE TABLE evidence_artifacts (
  evidence_id uuid NOT NULL REFERENCES evidence_records(id),
  artifact_id uuid NOT NULL REFERENCES artifacts(id),
  PRIMARY KEY (evidence_id, artifact_id)
);

CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  statement text NOT NULL,
  claim_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE claim_evidence (
  claim_id uuid NOT NULL REFERENCES claims(id),
  evidence_id uuid NOT NULL REFERENCES evidence_records(id),
  relationship text NOT NULL CHECK (relationship IN ('SUPPORTS', 'CONTRADICTS')),
  PRIMARY KEY (claim_id, evidence_id, relationship)
);

CREATE TABLE workflow_leases (
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  owner_id text NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (resource_type, resource_id)
);

CREATE TABLE side_effect_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  campaign_id uuid REFERENCES campaigns(id),
  invocation_id text NOT NULL,
  idempotency_key text NOT NULL,
  adapter_type text NOT NULL,
  adapter_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('STARTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  response_digest text CHECK (response_digest ~ '^sha256:[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (adapter_id, idempotency_key)
);

COMMIT;
