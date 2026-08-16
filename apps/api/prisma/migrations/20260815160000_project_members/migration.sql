CREATE TABLE "project_members" (
  "project_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by" TEXT NOT NULL,
  CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id", "actor_id"),
  CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "project_members_actor_id_organization_id_idx" ON "project_members"("actor_id", "organization_id");
