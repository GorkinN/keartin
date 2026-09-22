import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AppEnv } from "../config/env";
import { assertStorageKey, assertStoragePrefix, contentTypeForKey } from "./keys";
import { StorageProvider } from "./storage.provider";

export class S3Provider extends StorageProvider {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(env: AppEnv) {
    super();
    this.bucket = env.s3Bucket;
    this.client = new S3Client({
      endpoint: env.s3Endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.s3AccessKey,
        secretAccessKey: env.s3SecretKey,
      },
    });
  }

  async init(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async putBytes(key: string, body: Buffer): Promise<void> {
    assertStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentTypeForKey(key),
      }),
    );
  }

  async putText(key: string, text: string): Promise<void> {
    await this.putBytes(key, Buffer.from(text, "utf8"));
  }

  async getBytes(key: string): Promise<Buffer> {
    assertStorageKey(key);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) {
      throw new Error(`empty object: ${key}`);
    }
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertStoragePrefix(prefix);
    const listedPrefix = `${prefix}/`;
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: listedPrefix,
          ContinuationToken: token,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((item) => item.Key)
        .filter((key): key is string => Boolean(key));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        );
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
  }

  absolutePath(): string | null {
    return null;
  }

  absoluteDir(): string | null {
    return null;
  }
}
