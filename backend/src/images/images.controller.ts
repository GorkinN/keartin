import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Res, StreamableFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import { GenerateService } from "../generate/generate.service";
import { ImagesService, type UploadImage } from "./images.service";

@Controller("images")
export class ImagesController {
  constructor(
    private readonly images: ImagesService,
    private readonly generate: GenerateService,
  ) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "references", maxCount: 10 },
        { name: "mask", maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 11 } },
    ),
  )
  async start(
    @Body() body: unknown,
    @UploadedFiles() files?: { references?: UploadImage[]; mask?: UploadImage[] },
  ) {
    const item = await this.images.enqueue(body, files);
    this.generate.wake();
    return item;
  }

  @Get("queue")
  async queue() {
    return {
      cooldownUntil: this.generate.currentCooldown(),
      items: await this.images.listQueue(),
    };
  }

  @Delete("queue/:jobId")
  async removeQueued(@Param("jobId") jobId: string) {
    const result = await this.images.removeQueued(jobId);
    await this.generate.releasedQueue();
    return result;
  }

  @Get("jobs/:jobId/events")
  events(@Param("jobId") jobId: string, @Res() res: Response) {
    return this.images.events(jobId, res);
  }

  @Post("jobs/:jobId/cancel")
  @HttpCode(202)
  cancel(@Param("jobId") jobId: string) {
    return this.images.cancel(jobId);
  }

  @Get()
  list() {
    return this.images.list();
  }

  @Get(":id/files/:index")
  @Header("Cache-Control", "private, max-age=86400")
  async file(@Param("id") id: string, @Param("index") index: string): Promise<StreamableFile> {
    const bytes = await this.images.readFile(id, index);
    return new StreamableFile(bytes, { type: "image/png", disposition: "inline" });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.images.get(id);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.images.remove(id);
  }
}
