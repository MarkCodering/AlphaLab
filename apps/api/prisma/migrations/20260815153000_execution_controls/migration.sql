CREATE TABLE "organization_execution_controls" (
  "organization_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "campaign_execution_enabled" BOOLEAN NOT NULL,
  "experiment_execution_enabled" BOOLEAN NOT NULL,
  "external_network_access_enabled" BOOLEAN NOT NULL,
  "external_model_providers_enabled" BOOLEAN NOT NULL,
  "hugging_face_model_loading_enabled" BOOLEAN NOT NULL,
  "mcp_integrations_enabled" BOOLEAN NOT NULL,
  "cloud_infrastructure_execution_enabled" BOOLEAN NOT NULL,
  "domain_specific_tools_enabled" BOOLEAN NOT NULL,
  "verified_discovery_generation_enabled" BOOLEAN NOT NULL,
  "automatic_fallback_enabled" BOOLEAN NOT NULL,
  "background_scheduling_enabled" BOOLEAN NOT NULL,
  "evidence_read_only" BOOLEAN NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_by" TEXT NOT NULL,
  CONSTRAINT "organization_execution_controls_pkey" PRIMARY KEY ("organization_id")
);
