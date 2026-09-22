import { Module } from "@nestjs/common";
import { PostFiles } from "../posts/post-files";
import { GenerateController } from "./generate.controller";
import { GenerateService } from "./generate.service";
import { JobHub } from "./job-hub";

@Module({
  controllers: [GenerateController],
  providers: [GenerateService, JobHub, PostFiles],
  exports: [GenerateService],
})
export class GenerateModule {}
