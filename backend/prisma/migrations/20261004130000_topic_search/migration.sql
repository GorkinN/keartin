-- CreateTable
CREATE TABLE "TopicSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "area" TEXT NOT NULL DEFAULT '',
    "bookIds" TEXT NOT NULL DEFAULT '[]',
    "topics" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
