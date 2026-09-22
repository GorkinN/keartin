import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppEnv } from "../config/env";
import { assertStorageKey, assertStoragePrefix } from "./keys";
import { StorageProvider } from "./storage.provider";

export class LocalFsProvider extends StorageProvider {
  readonly driver = "fs" as const;
  private readonly root: string;

  constructor(env: AppEnv) {
    super();
    this.root = join(env.repoRoot, "data");
  }

  async init(): Promise<void> {
    await mkdir(join(this.root, "library"), { recursive: true });
    await mkdir(join(this.root, "posts"), { recursive: true });
    await mkdir(join(this.root, "sqlite"), { recursive: true });
    await mkdir(join(this.root, "tmp", "index"), { recursive: true });
    await mkdir(join(this.root, "tmp", "pipeline"), { recursive: true });
  }

  async putBytes(key: string, body: Buffer): Promise<void> {
    const file = this.mustPath(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async putText(key: string, text: string): Promise<void> {
    await this.putBytes(key, Buffer.from(text, "utf8"));
  }

  async getBytes(key: string): Promise<Buffer> {
    return readFile(this.mustPath(key));
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertStoragePrefix(prefix);
    await rm(this.dir(prefix), { recursive: true, force: true });
  }

  absolutePath(key: string): string | null {
    return this.mustPath(key);
  }

  absoluteDir(prefix: string): string | null {
    assertStoragePrefix(prefix);
    return this.dir(prefix);
  }

  private mustPath(key: string): string {
    assertStorageKey(key);
    return join(this.root, ...key.split("/"));
  }

  private dir(prefix: string): string {
    return join(this.root, ...prefix.split("/"));
  }
}
