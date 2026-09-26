-- CreateTable
CREATE TABLE "TonePreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Seed starter tones. Newer rows sort first; these stay editable and are not reinserted.
-- Timestamps are unix milliseconds: Prisma stores SQLite DateTime that way.
INSERT INTO "TonePreset" ("id", "name", "text", "createdAt", "updatedAt") VALUES
('tone-zhivoy', 'живой, разговорный', 'живой, разговорный', 1790438408000, 1790438408000),
('tone-expert', 'экспертный', 'экспертный', 1790438407000, 1790438407000),
('tone-friendly', 'дружелюбный', 'дружелюбный', 1790438406000, 1790438406000),
('tone-ironic', 'ироничный', 'ироничный', 1790438405000, 1790438405000),
('tone-provocative', 'провокационный', 'провокационный', 1790438404000, 1790438404000),
('tone-inspiring', 'вдохновляющий', 'вдохновляющий', 1790438403000, 1790438403000),
('tone-mentor', 'спокойный, наставнический', 'спокойный, наставнический', 1790438402000, 1790438402000),
('tone-dry', 'сухой, по делу', 'сухой, по делу', 1790438401000, 1790438401000),
('tone-formal', 'официальный', 'официальный', 1790438400000, 1790438400000);
