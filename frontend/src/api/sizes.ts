export const IMAGE_STEPS = 20;

export const SIZE_PRESETS = [
  { id: "square", label: "Квадрат", width: 1024, height: 1024 },
  { id: "portrait", label: "Портрет 4:5", width: 768, height: 960 },
  { id: "wide", label: "Широкий 16:9", width: 1024, height: 576 },
  { id: "story", label: "История 9:16", width: 576, height: 1024 },
  { id: "draft", label: "Черновик", width: 512, height: 512 },
  { id: "custom", label: "Свой размер", width: null, height: null },
] as const;

export type SizePresetId = (typeof SIZE_PRESETS)[number]["id"];

export type SizeChoice = { id: string; label: string; width: number | null; height: number | null };

export function resolveSize(
  preset: string,
  widthRaw: string,
  heightRaw: string,
  presets: readonly SizeChoice[] = SIZE_PRESETS,
  maxSide = 1024,
): { width: number; height: number } | { error: string } {
  if (preset !== "custom") {
    const found = presets.find((item) => item.id === preset);
    if (!found || found.width === null || found.height === null) return { error: "Выберите размер" };
    return { width: found.width, height: found.height };
  }
  const widthError = sideError(widthRaw, "Ширина", maxSide);
  if (widthError) return { error: widthError };
  const heightError = sideError(heightRaw, "Высота", maxSide);
  if (heightError) return { error: heightError };
  return { width: Number(widthRaw.trim()), height: Number(heightRaw.trim()) };
}

function sideError(raw: string, name: string, maxSide: number): string | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return `${name} должна быть целым числом`;
  const value = Number(text);
  if (value < 256 || value > maxSide) return `${name} должна быть от 256 до ${maxSide}`;
  if (value % 16 !== 0) return `${name} должна делиться на 16`;
  return null;
}
