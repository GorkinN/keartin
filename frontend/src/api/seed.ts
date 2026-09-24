export function parseSeed(text: string): { value?: number; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { error: null };
  if (!/^\d+$/.test(trimmed)) return { error: "Seed — целое от 0 до 2147483647" };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value > 2_147_483_647) {
    return { error: "Seed — целое от 0 до 2147483647" };
  }
  return { value, error: null };
}

export function gpuBusyLabel(status: { locked: boolean; tenant: string | null } | undefined): string | null {
  if (!status?.locked) return null;
  if (status.tenant === "llm" || status.tenant === "flux") return `GPU занят: ${status.tenant}`;
  return "GPU занят";
}
