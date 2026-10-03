import type { SizeChoice } from "@/api/sizes";

export type ImageModelId = "flux" | "qwen";

export const QWEN_SIZE_PRESETS: readonly SizeChoice[] = [
  { id: "square", label: "Квадрат 1:1", width: 1024, height: 1024 },
  { id: "fourThree", label: "4:3", width: 1024, height: 768 },
  { id: "threeFour", label: "3:4", width: 768, height: 1024 },
  { id: "threeTwo", label: "3:2", width: 1024, height: 688 },
  { id: "twoThree", label: "2:3", width: 688, height: 1024 },
  { id: "wide", label: "16:9", width: 1024, height: 576 },
  { id: "story", label: "9:16", width: 576, height: 1024 },
  { id: "square2k", label: "2K 1:1", width: 2048, height: 2048 },
  { id: "fourThree2k", label: "2K 4:3", width: 2400, height: 1792 },
  { id: "threeFour2k", label: "2K 3:4", width: 1792, height: 2400 },
  { id: "threeTwo2k", label: "2K 3:2", width: 2528, height: 1696 },
  { id: "twoThree2k", label: "2K 2:3", width: 1696, height: 2528 },
  { id: "wide2k", label: "2K 16:9", width: 2752, height: 1536 },
  { id: "story2k", label: "2K 9:16", width: 1536, height: 2752 },
  { id: "custom", label: "Свой размер", width: null, height: null },
];

export function imageModelId(value: string): ImageModelId {
  const text = value.toLowerCase();
  if (text === "qwen" || text.includes("qwen")) return "qwen";
  return "flux";
}

export function imageModelLabel(value: string): string {
  const text = value.toLowerCase();
  if (text === "qwen" || text.includes("qwen")) return "Qwen-Image-2.1";
  if (text === "flux" || text.includes("flux") || text === "") return "Flux";
  return value;
}

export function stepBounds(model: ImageModelId): { min: number; max: number; fallback: number } {
  if (model === "qwen") return { min: 20, max: 50, fallback: 40 };
  return { min: 20, max: 28, fallback: 20 };
}

export function sideMax(model: ImageModelId): number {
  return model === "qwen" ? 2752 : 1024;
}
