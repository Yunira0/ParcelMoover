-- AlterTable
ALTER TABLE "cod_collections" ALTER COLUMN "pending_amount" SET DEFAULT ("cod_amount" - "remitted_amount");
