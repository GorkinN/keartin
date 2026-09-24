-- CreateTable
CREATE TABLE "ImagePromptPreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
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
    "imagePresetId" TEXT,
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
    CONSTRAINT "Post_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "StylePreset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Post_imagePresetId_fkey" FOREIGN KEY ("imagePresetId") REFERENCES "ImagePromptPreset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Post" (
    "id", "topic", "tone", "length", "emoji", "knowledgeMode", "citations", "hooks", "body", "cta",
    "bookIds", "topK", "presetId", "temperature", "width", "height", "steps", "imageSeed", "text",
    "imagePrompt", "imageKey", "storagePrefix", "slug", "llmModel", "fluxModel", "sources", "status",
    "createdAt", "updatedAt"
) SELECT
    "id", "topic", "tone", "length", "emoji", "knowledgeMode", "citations", "hooks", "body", "cta",
    "bookIds", "topK", "presetId", "temperature", "width", "height", "steps", "imageSeed", "text",
    "imagePrompt", "imageKey", "storagePrefix", "slug", "llmModel", "fluxModel", "sources", "status",
    "createdAt", "updatedAt"
FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE UNIQUE INDEX "Post_storagePrefix_key" ON "Post"("storagePrefix");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
