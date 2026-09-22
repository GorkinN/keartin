import { Injectable } from "@nestjs/common";
import { resolve } from "node:path";

export type StorageDriver = "fs" | "s3";

export function repoRoot(): string {
  return resolve(__dirname, "../../..");
}

export function ignoreLocalProxy(): void {
  const extra = ["127.0.0.1", "localhost"];
  for (const key of ["NO_PROXY", "no_proxy"] as const) {
    const current = process.env[key] ?? "";
    const parts = current
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const item of extra) {
      if (!parts.includes(item)) parts.push(item);
    }
    process.env[key] = parts.join(",");
  }
}

export function readStorageDriver(): StorageDriver {
  const raw = process.env.STORAGE_DRIVER;
  if (raw === undefined) return "fs";
  if (raw === "fs" || raw === "s3") return raw;
  throw new Error(`STORAGE_DRIVER must be fs or s3, got ${raw}`);
}

@Injectable()
export class AppEnv {
  readonly repoRoot = repoRoot();
  readonly aiServiceUrl: string;
  readonly storageDriver: StorageDriver;
  readonly s3Endpoint: string;
  readonly s3Bucket: string;
  readonly s3AccessKey: string;
  readonly s3SecretKey: string;
  readonly llmModel: string;
  readonly fluxModelId: string;

  constructor() {
    ignoreLocalProxy();
    this.storageDriver = readStorageDriver();
    this.aiServiceUrl = (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    this.s3Endpoint = process.env.MINIO_ENDPOINT ?? "http://127.0.0.1:9000";
    this.s3Bucket = process.env.S3_BUCKET ?? "library";
    this.s3AccessKey = process.env.S3_ACCESS_KEY ?? "minioadmin";
    this.s3SecretKey = process.env.S3_SECRET_KEY ?? "minioadmin";
    this.llmModel = process.env.LLM_MODEL ?? "";
    this.fluxModelId = process.env.FLUX_MODEL_ID ?? "";
  }
}
