ALTER TABLE "target_versions"
  ADD COLUMN "initial_hypotheses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
