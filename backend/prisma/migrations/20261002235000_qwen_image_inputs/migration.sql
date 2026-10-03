-- AlterTable
ALTER TABLE "ImageBatch" ADD COLUMN "transparent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ImageBatch" ADD COLUMN "referenceKeys" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ImageBatch" ADD COLUMN "maskKey" TEXT NOT NULL DEFAULT '';
