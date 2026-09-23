export function bookStatusLabel(status: string): string {
  if (status === "indexing") return "индексация";
  if (status === "ready") return "готово";
  if (status === "error") return "ошибка";
  return status;
}

export function postStatusLabel(status: string): string {
  if (status === "draft") return "черновик";
  if (status === "ready") return "готов";
  if (status === "failed") return "ошибка";
  return status;
}

export function lengthLabel(length: string): string {
  if (length === "S") return "S · около 500";
  if (length === "M") return "M · около 1200";
  if (length === "L") return "L · около 2500";
  return length;
}

export function knowledgeLabel(mode: string): string {
  if (mode === "rag") return "только книги";
  if (mode === "rag_plus") return "книги и общие знания";
  if (mode === "general") return "общие знания";
  return mode;
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU");
}
