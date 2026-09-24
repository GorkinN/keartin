import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ImagePresetsService } from "./image-presets.service";

@Controller("image-presets")
export class ImagePresetsController {
  constructor(private readonly presets: ImagePresetsService) {}

  @Get()
  list() {
    return this.presets.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.presets.get(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown) {
    return this.presets.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.presets.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.presets.remove(id);
  }
}
