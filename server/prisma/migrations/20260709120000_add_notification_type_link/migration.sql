-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "notifications" ADD COLUMN "link" TEXT;
