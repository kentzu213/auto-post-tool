-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "workspaceId" TEXT,
ADD COLUMN     "resourceType" TEXT,
ADD COLUMN     "resourceId" TEXT,
ADD COLUMN     "outcome" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_outcome_idx" ON "audit_logs"("workspaceId", "outcome");
