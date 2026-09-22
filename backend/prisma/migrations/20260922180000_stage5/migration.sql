-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "indexJobId" TEXT,
    "error" TEXT,
    "chunksTotal" INTEGER NOT NULL DEFAULT 0,
    "chunksDone" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StylePreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "examples" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT '',
    "length" TEXT NOT NULL DEFAULT 'M',
    "emoji" BOOLEAN NOT NULL DEFAULT false,
    "knowledgeMode" TEXT NOT NULL DEFAULT 'rag',
    "citations" BOOLEAN NOT NULL DEFAULT false,
    "hooks" BOOLEAN NOT NULL DEFAULT true,
    "body" BOOLEAN NOT NULL DEFAULT true,
    "cta" BOOLEAN NOT NULL DEFAULT true,
    "bookIds" TEXT NOT NULL DEFAULT '[]',
    "topK" INTEGER NOT NULL DEFAULT 10,
    "presetId" TEXT,
    "temperature" REAL,
    "width" INTEGER NOT NULL DEFAULT 1024,
    "height" INTEGER NOT NULL DEFAULT 1024,
    "steps" INTEGER NOT NULL DEFAULT 28,
    "imageSeed" INTEGER,
    "text" TEXT NOT NULL DEFAULT '',
    "imagePrompt" TEXT NOT NULL DEFAULT '',
    "imageKey" TEXT NOT NULL DEFAULT '',
    "storagePrefix" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "llmModel" TEXT NOT NULL DEFAULT '',
    "fluxModel" TEXT NOT NULL DEFAULT '',
    "sources" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "StylePreset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationJob_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Post_storagePrefix_key" ON "Post"("storagePrefix");

-- CreateIndex
CREATE INDEX "GenerationJob_postId_status_idx" ON "GenerationJob"("postId", "status");
