CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" TEXT NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "target_versions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "scientific_goal" TEXT NOT NULL,
    "research_question" TEXT NOT NULL,
    "acceptance_criteria" TEXT[],
    "verification_policy_id" TEXT NOT NULL,
    "stop_conditions" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" TEXT NOT NULL,
    CONSTRAINT "target_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "target_version_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resume_status" TEXT,
    "state_version" INTEGER NOT NULL,
    "budget_version" INTEGER NOT NULL,
    "budget_limit" JSONB NOT NULL,
    "budget_usage" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_events" (
    "event_id" TEXT NOT NULL,
    "contract_version" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "target_version_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "causation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "actor" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "payload" JSONB NOT NULL,
    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("event_id")
);

CREATE TABLE "idempotency_records" (
    "scope" TEXT NOT NULL,
    "request_digest" TEXT NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("scope")
);

CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "action" JSONB NOT NULL,
    "action_digest" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approval" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "side_effect_receipts" (
    "invocation_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "request_digest" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result_reference" JSONB,
    "usage" JSONB,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "side_effect_receipts_pkey" PRIMARY KEY ("invocation_id")
);

CREATE TABLE "artifacts" (
    "digest" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "byte_length" BIGINT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("digest")
);

CREATE TABLE "evidence_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "artifact_digests" TEXT[],
    "provenance" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "invalidates_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "projects_organization_id_idx" ON "projects"("organization_id");
CREATE INDEX "target_versions_project_id_idx" ON "target_versions"("project_id");
CREATE UNIQUE INDEX "target_versions_target_id_version_key" ON "target_versions"("target_id", "version");
CREATE INDEX "campaigns_project_id_status_idx" ON "campaigns"("project_id", "status");
CREATE INDEX "domain_events_campaign_id_occurred_at_idx" ON "domain_events"("campaign_id", "occurred_at");
CREATE INDEX "approval_requests_campaign_id_status_idx" ON "approval_requests"("campaign_id", "status");
CREATE INDEX "side_effect_receipts_campaign_id_kind_idx" ON "side_effect_receipts"("campaign_id", "kind");
CREATE INDEX "artifacts_project_id_idx" ON "artifacts"("project_id");
CREATE INDEX "evidence_records_campaign_id_classification_idx" ON "evidence_records"("campaign_id", "classification");
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");
