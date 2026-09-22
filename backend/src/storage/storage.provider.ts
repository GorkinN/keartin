export abstract class StorageProvider {
  abstract readonly driver: "fs" | "s3";
  abstract init(): Promise<void>;
  abstract putBytes(key: string, body: Buffer): Promise<void>;
  abstract putText(key: string, text: string): Promise<void>;
  abstract getBytes(key: string): Promise<Buffer>;
  abstract deletePrefix(prefix: string): Promise<void>;
  abstract absolutePath(key: string): string | null;
  abstract absoluteDir(prefix: string): string | null;
}
