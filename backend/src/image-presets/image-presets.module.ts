import { Module } from "@nestjs/common";
import { ImagePresetsController } from "./image-presets.controller";
import { ImagePresetsService } from "./image-presets.service";

@Module({
  controllers: [ImagePresetsController],
  providers: [ImagePresetsService],
  exports: [ImagePresetsService],
})
export class ImagePresetsModule {}
