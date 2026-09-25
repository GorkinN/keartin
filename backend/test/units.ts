import assert from "node:assert/strict";
import { consumeSse, flushSse } from "../src/ai/sse";
import { batchSeed } from "../src/generate/input";
import { localDateStamp, nextStoragePrefix, slugifyTopic } from "../src/posts/slug";

assert.equal(batchSeed(null, 0, 3), null);
assert.equal(batchSeed(42, 0, 1), 42);
assert.equal(batchSeed(42, 0, 3), 42);
assert.equal(batchSeed(42, 2, 3), 44);
assert.equal(batchSeed(2_147_483_647, 1, 2), 0);

assert.equal(slugifyTopic("цена и спрос"), "tsena-i-spros");
assert.equal(slugifyTopic("  Привет, мир!  "), "privet-mir");
assert.equal(slugifyTopic("письмо"), "pismo");
assert.equal(slugifyTopic("***"), "post");
assert.equal(slugifyTopic("a".repeat(80)).length <= 40, true);

async function checkPrefixes(): Promise<void> {
  const stamp = localDateStamp(new Date(2026, 8, 22));
  assert.equal(stamp, "2026-09-22");
  const taken = new Set<string>();
  const when = new Date(2026, 8, 22);
  const first = await nextStoragePrefix("цена и спрос", async (prefix) => taken.has(prefix), when);
  assert.equal(first.storagePrefix, "posts/2026-09-22_tsena-i-spros");
  taken.add(first.storagePrefix);
  const second = await nextStoragePrefix("цена и спрос", async (prefix) => taken.has(prefix), when);
  assert.equal(second.slug, "tsena-i-spros-2");
}

const split = consumeSse('event: token\ndata: {"text":"а"}\n\nevent: status\ndata: {"pha');
assert.equal(split.events.length, 1);
assert.equal(split.events[0].event, "token");
assert.deepEqual(split.events[0].data, { text: "а" });
const rest = flushSse(`${split.rest}se":"start"}\n\n`);
assert.equal(rest.length, 1);
assert.equal(rest[0].event, "status");
assert.deepEqual(rest[0].data, { phase: "start" });

const crlf = consumeSse('event: error\r\ndata: {"message":"недостаточно контекста"}\r\n\r\n');
assert.equal(crlf.events.length, 1);
assert.deepEqual(crlf.events[0].data, { message: "недостаточно контекста" });

checkPrefixes()
  .then(() => {
    console.log("units ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
