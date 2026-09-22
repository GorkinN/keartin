const { config } = require("dotenv");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

config({ path: resolve(__dirname, "../../.env") });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:../../data/sqlite/app.db";
}

const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), ...args], {
  stdio: "inherit",
  env: process.env,
  cwd: resolve(__dirname, ".."),
});
process.exit(result.status ?? 1);
