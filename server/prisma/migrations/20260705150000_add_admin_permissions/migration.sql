-- AlterTable
ALTER TABLE "admins" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT '{}';
