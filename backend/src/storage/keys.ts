const PREFIX =
  /^(library|posts)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const KEY =
  /^(library|posts)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertStoragePrefix(prefix: string): void {
  if (!PREFIX.test(prefix)) {
    throw new Error(`bad storage prefix: ${prefix}`);
  }
}

export function assertStorageKey(key: string): void {
  if (!KEY.test(key)) {
    throw new Error(`bad storage key: ${key}`);
  }
}

export function contentTypeForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".epub")) return "application/epub+zip";
  if (lower.endsWith(".fb2")) return "application/xml";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}
