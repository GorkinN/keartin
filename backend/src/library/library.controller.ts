import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { LibraryService, type UploadFile } from "./library.service";

const MAX_BYTES = 200 * 1024 * 1024;

@Controller("library")
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get("books")
  list() {
    return this.library.list();
  }

  @Get("books/:id")
  get(@Param("id") id: string) {
    return this.library.get(id);
  }

  @Post("books")
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
    }),
  )
  upload(@UploadedFile() file?: UploadFile) {
    return this.library.upload(file);
  }

  @Post("books/:id/reindex")
  @HttpCode(202)
  reindex(@Param("id") id: string) {
    return this.library.reindex(id);
  }

  @Post("books/:id/outline")
  outline(@Param("id") id: string) {
    return this.library.outline(id);
  }

  @Delete("books/:id")
  remove(@Param("id") id: string) {
    return this.library.remove(id);
  }
}
