import { Controller, Delete, Get, Header, HttpCode, Param, Post, StreamableFile } from "@nestjs/common";
import { GenerateService } from "../generate/generate.service";
import { PostsService } from "./posts.service";

@Controller("posts")
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly generate: GenerateService,
  ) {}

  @Get()
  list() {
    return this.posts.list();
  }

  @Get(":id/image")
  @Header("Cache-Control", "private, max-age=86400")
  async image(@Param("id") id: string): Promise<StreamableFile> {
    const bytes = await this.posts.readImage(id);
    return new StreamableFile(bytes, { type: "image/png", disposition: "inline" });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.posts.get(id);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.posts.remove(id);
  }

  @Post(":id/open-folder")
  @HttpCode(200)
  openFolder(@Param("id") id: string) {
    return this.posts.openFolder(id);
  }

  @Post(":id/regenerate-text")
  @HttpCode(202)
  regenerateText(@Param("id") id: string) {
    return this.generate.regenerateText(id);
  }

  @Post(":id/regenerate-image")
  @HttpCode(202)
  regenerateImage(@Param("id") id: string) {
    return this.generate.regenerateImage(id);
  }
}
