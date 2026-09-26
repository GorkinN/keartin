import { Module } from "@nestjs/common";
import { TonePresetsController } from "./tone-presets.controller";
import { TonePresetsService } from "./tone-presets.service";

@Module({
  controllers: [TonePresetsController],
  providers: [TonePresetsService],
  exports: [TonePresetsService],
})
export class TonePresetsModule {}
