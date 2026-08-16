-- Dataset versions are append-only. Existing campaigns retain an empty source set
-- until a researcher explicitly creates a later immutable campaign configuration.
ALTER TABLE "campaigns"
  ADD COLUMN "dataset_version_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "dataset_versions" (
  "id" TEXT NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "source_pointer" TEXT NOT NULL,
  "license" TEXT NOT NULL,
  "content_digest" TEXT NOT NULL,
  "artifact" JSONB,
  "record_count" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by" TEXT NOT NULL,
  CONSTRAINT "dataset_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dataset_versions_dataset_id_version_key"
  ON "dataset_versions"("dataset_id", "version");
CREATE INDEX "dataset_versions_project_id_dataset_id_idx"
  ON "dataset_versions"("project_id", "dataset_id");
