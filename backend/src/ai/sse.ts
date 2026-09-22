export type SseEvent = { event: string; data: unknown };

export function consumeSse(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const chunks = normalized.split("\n\n");
  const rest = chunks.pop() ?? "";
  const events: SseEvent[] = [];
  for (const chunk of chunks) {
    const parsed = parseBlock(chunk);
    if (parsed) events.push(parsed);
  }
  return { events, rest };
}

export function flushSse(buffer: string): SseEvent[] {
  if (!buffer.trim()) return [];
  return consumeSse(`${buffer}\n\n`).events;
}

function parseBlock(chunk: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const raw of chunk.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      let value = line.slice(5);
      if (value.startsWith(" ")) value = value.slice(1);
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) return null;
  const rawData = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(rawData) as unknown };
  } catch {
    return { event, data: rawData };
  }
}
