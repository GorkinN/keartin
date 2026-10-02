import { Module } from "@nestjs/common";
import { ImagesController } from "../images/images.controller";
import { ImagesService } from "../images/images.service";
import { PostFiles } from "../posts/post-files";
import { GenerateController } from "./generate.controller";
import { GenerateService } from "./generate.service";
import { GpuController } from "./gpu.controller";
import { JobHub } from "./job-hub";

@Module({
  controllers: [GenerateController, GpuController, ImagesController],
  providers: [GenerateService, ImagesService, JobHub, PostFiles],
  exports: [GenerateService],
})
export class GenerateModule {}
