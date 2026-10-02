-- CreateTable
CREATE TABLE "ImageBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prompt" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "steps" INTEGER NOT NULL,
    "seed" INTEGER,
    "count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "fluxModel" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GeneratedImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "seed" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneratedImage_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImageBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedImage_batchId_index_key" ON "GeneratedImage"("batchId", "index");

-- CreateTable
CREATE TABLE "ImageJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImageJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImageBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ImageJob_batchId_key" ON "ImageJob"("batchId");

-- CreateIndex
CREATE INDEX "ImageJob_status_createdAt_idx" ON "ImageJob"("status", "createdAt");
