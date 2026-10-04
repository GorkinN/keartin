import assert from "node:assert/strict";
import { consumeSse, flushSse } from "../src/ai/sse";
import { batchSeed, parseGenerateInput } from "../src/generate/input";
import { parseImageBatchInput } from "../src/images/input";
import { localDateStamp, nextStoragePrefix, slugifyTopic } from "../src/posts/slug";
import { NewsRssError, fetchNewsHeadlines, newsRssUrl, parseNewsTitles } from "../src/topics/news-rss";
import { assertStorageKey, assertStoragePrefix } from "../src/storage/keys";

assert.equal(batchSeed(null, 0, 3), null);
assert.equal(batchSeed(42, 0, 1), 42);
assert.equal(batchSeed(42, 0, 3), 42);
assert.equal(batchSeed(42, 2, 3), 44);
assert.equal(batchSeed(2_147_483_647, 1, 2), 0);

assert.equal(parseGenerateInput({ topic: "тема" }).withImage, true);
assert.equal(parseGenerateInput({ topic: "тема", withImage: false }).withImage, false);
assert.throws(() => parseGenerateInput({ topic: "тема", withImage: "no" }));

const imageBatch = parseImageBatchInput({ prompt: "  a red fox  ", count: 2, steps: 22, width: 512, height: 512 });
assert.equal(imageBatch.prompt, "a red fox");
assert.equal(imageBatch.count, 2);
assert.equal(imageBatch.steps, 22);
assert.equal(imageBatch.seed, null);
assert.equal(parseImageBatchInput({ prompt: "cat" }).steps, 20);
assert.equal(parseImageBatchInput({ prompt: "cat" }).model, "flux");
assert.equal(parseImageBatchInput({ prompt: "cat", model: "qwen" }).steps, 40);
assert.equal(
  parseImageBatchInput({ prompt: "cat", model: "qwen", width: "2048", height: "2048", steps: "40", transparent: "true" }).transparent,
  true,
);
assert.throws(() => parseImageBatchInput({ prompt: "cat", transparent: true }));
assert.equal(parseGenerateInput({ topic: "тема" }).imageGguf, "");
assert.equal(parseGenerateInput({ topic: "тема", imageModel: "qwen", gguf: "qwen-image-2.1-UC-Q4_K_M.gguf" }).imageGguf, "qwen-image-2.1-UC-Q4_K_M.gguf");
assert.throws(() => parseGenerateInput({ topic: "тема", gguf: "qwen.gguf" }));
assert.throws(() => parseImageBatchInput({ prompt: "cat", model: "qwen", gguf: "C:/weights/qwen.gguf" }));
assert.equal(parseGenerateInput({ topic: "тема" }).imageModel, "flux");
assert.equal(parseGenerateInput({ topic: "тема", imageModel: "qwen", width: 2048, height: 2048 }).steps, 40);
assert.throws(() => parseImageBatchInput({ prompt: "cat", width: 1000 }));
assert.throws(() => parseImageBatchInput({ prompt: "   " }));
assert.throws(() => parseImageBatchInput({ prompt: "cat", count: 21 }));
assert.doesNotThrow(() => assertStoragePrefix("images/clh3batch"));
assert.doesNotThrow(() => assertStorageKey("images/clh3batch/0.png"));
assert.throws(() => assertStoragePrefix("other/abc"));

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
  const imageSlot = await nextStoragePrefix("red fox", async () => false, when, "images");
  assert.equal(imageSlot.storagePrefix, "images/2026-09-22_red-fox");
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

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Цена &amp; &lt;b&gt;спрос&lt;/b&gt;</title></item>
<item><title><![CDATA[Римские дороги]]></title></item>
<item><title>Цена &amp; &lt;b&gt;спрос&lt;/b&gt;</title></item>
<item><title>   </title></item>
</channel></rss>`;
assert.deepEqual(parseNewsTitles(rss), ["Цена & спрос", "Римские дороги"]);
assert.deepEqual(parseNewsTitles(`<?xml version="1.0"?><rss><channel><title>лента</title></channel></rss>`), []);
assert.throws(() => parseNewsTitles("<html><title>нет</title></html>"), NewsRssError);
const many = Array.from({ length: 30 }, (_, index) => `<item><title>t${index}</title></item>`).join("");
assert.equal(parseNewsTitles(`<rss><channel>${many}</channel></rss>`).length, 24);
assert.equal(parseNewsTitles(`<rss><channel><item><title>${"я".repeat(250)}</title></item></channel></rss>`)[0].length, 200);
assert.equal(
  newsRssUrl("привычки"),
  "https://news.google.com/rss/search?q=%D0%BF%D1%80%D0%B8%D0%B2%D1%8B%D1%87%D0%BA%D0%B8&hl=ru&gl=RU&ceid=RU%3Aru",
);

async function checkRss(): Promise<void> {
  const empty = `<?xml version="1.0"?><rss><channel></channel></rss>`;
  await assert.rejects(
    () => fetchNewsHeadlines("привычки", async () => new Response(empty, { status: 200 })),
    (error: unknown) => error instanceof NewsRssError && error.kind === "empty",
  );
  await assert.rejects(
    () => fetchNewsHeadlines("привычки", async () => new Response("down", { status: 503 })),
    (error: unknown) => error instanceof NewsRssError && error.kind === "fetch",
  );
}

checkPrefixes()
  .then(() => checkRss())
  .then(() => {
    console.log("units ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
