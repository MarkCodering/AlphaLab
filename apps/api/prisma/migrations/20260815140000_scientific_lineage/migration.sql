-- Additive scientific-lineage fields keep previously stored evidence readable.
ALTER TABLE "evidence_records"
  ADD COLUMN "run_id" TEXT NOT NULL DEFAULT 'legacy-run',
  ADD COLUMN "target_version_id" TEXT NOT NULL DEFAULT 'legacy-target',
  ADD COLUMN "supports_claim_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "contradicts_claim_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "source_pointers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "verification_reports" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "predicate_results" JSONB NOT NULL,
  "candidate_eligible" BOOLEAN NOT NULL,
  "human_approval_required" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "verification_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verification_reports_campaign_id_created_at_idx"
  ON "verification_reports"("campaign_id", "created_at");

CREATE TABLE "reproducibility_bundles" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "target_version_id" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "manifest_digest" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "reproducibility_bundles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reproducibility_bundles_campaign_id_created_at_idx"
  ON "reproducibility_bundles"("campaign_id", "created_at");
