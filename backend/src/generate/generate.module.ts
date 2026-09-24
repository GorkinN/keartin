import { Module } from "@nestjs/common";
import { PostFiles } from "../posts/post-files";
import { GenerateController } from "./generate.controller";
import { GenerateService } from "./generate.service";
import { GpuController } from "./gpu.controller";
import { JobHub } from "./job-hub";

@Module({
  controllers: [GenerateController, GpuController],
  providers: [GenerateService, JobHub, PostFiles],
  exports: [GenerateService],
})
export class GenerateModule {}
