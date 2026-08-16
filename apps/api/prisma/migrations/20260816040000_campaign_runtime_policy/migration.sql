ALTER TABLE "campaigns"
  ADD COLUMN "permitted_model_ids" TEXT[] NOT NULL DEFAULT ARRAY['reference-local-worker-model-v1', 'deterministic-statistics-v1']::TEXT[],
  ADD COLUMN "permitted_tool_ids" TEXT[] NOT NULL DEFAULT ARRAY['reference-local-executor-v1']::TEXT[],
  ADD COLUMN "fallback_mode" TEXT NOT NULL DEFAULT 'STOP',
  ADD COLUMN "approved_fallback_model_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
