-- AlterTable
ALTER TABLE "Book" ADD COLUMN "outline" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Book" ADD COLUMN "outlineError" TEXT;
