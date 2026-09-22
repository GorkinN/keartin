import { Injectable } from "@nestjs/common";
import type { Post } from "@prisma/client";
import { asFileText } from "../common/json";
import { StorageProvider } from "../storage/storage.provider";
import { postMeta } from "./post.dto";

@Injectable()
export class PostFiles {
  constructor(private readonly storage: StorageProvider) {}

  async writeText(post: Post): Promise<void> {
    const body = asFileText(post.text);
    await this.storage.putText(`${post.storagePrefix}/post.md`, body);
    await this.storage.putText(`${post.storagePrefix}/post.txt`, body);
    await this.writeMeta(post);
  }

  async writeImage(post: Post, png: Buffer): Promise<void> {
    await this.storage.putBytes(`${post.storagePrefix}/image.png`, png);
    await this.storage.putText(
      `${post.storagePrefix}/image_prompt.txt`,
      asFileText(post.imagePrompt),
    );
    await this.writeMeta(post);
  }

  async writeAll(post: Post, png: Buffer): Promise<void> {
    const body = asFileText(post.text);
    await this.storage.putText(`${post.storagePrefix}/post.md`, body);
    await this.storage.putText(`${post.storagePrefix}/post.txt`, body);
    await this.storage.putText(
      `${post.storagePrefix}/image_prompt.txt`,
      asFileText(post.imagePrompt),
    );
    await this.storage.putBytes(`${post.storagePrefix}/image.png`, png);
    await this.writeMeta(post);
  }

  private async writeMeta(post: Post): Promise<void> {
    await this.storage.putText(`${post.storagePrefix}/meta.json`, postMeta(post));
  }
}
