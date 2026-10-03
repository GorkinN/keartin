-- AlterTable
ALTER TABLE "ImageBatch" ADD COLUMN "storagePrefix" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ImageBatch_storagePrefix_key" ON "ImageBatch"("storagePrefix");
