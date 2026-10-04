const MAX_HEADLINES = 24;
const MAX_TITLE_CHARS = 200;
const USER_AGENT = "llm-keartin/0.1";

export class NewsRssError extends Error {
  constructor(readonly kind: "empty" | "fetch") {
    super(kind === "empty" ? "По этому запросу заголовков не нашлось." : "Не удалось получить заголовки.");
    this.name = "NewsRssError";
  }
}

export function newsRssUrl(area: string): string {
  const query = new URLSearchParams({
    q: area,
    hl: "ru",
    gl: "RU",
    ceid: "RU:ru",
  });
  return `https://news.google.com/rss/search?${query.toString()}`;
}

export function parseNewsTitles(xml: string): string[] {
  if (!/<(rss|channel)\b/i.test(xml)) throw new NewsRssError("fetch");
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = itemTitle(item[1] ?? "");
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title.slice(0, MAX_TITLE_CHARS));
    if (titles.length === MAX_HEADLINES) break;
  }
  return titles;
}

export async function fetchNewsHeadlines(area: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchImpl(newsRssUrl(area), {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new NewsRssError("fetch");
  }
  if (!response.ok) throw new NewsRssError("fetch");
  let xml = "";
  try {
    xml = await response.text();
  } catch {
    throw new NewsRssError("fetch");
  }
  const titles = parseNewsTitles(xml);
  if (titles.length === 0) throw new NewsRssError("empty");
  return titles;
}

function itemTitle(itemXml: string): string {
  const match = itemXml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  let inner = (match[1] ?? "").trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) inner = cdata[1] ?? "";
  return decodeEntities(inner)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return codePoint(Number.parseInt(body.slice(2), 16), all);
    if (body.startsWith("#")) return codePoint(Number.parseInt(body.slice(1), 10), all);
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return named[body] ?? all;
  });
}

function codePoint(code: number, fallback: string): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}
