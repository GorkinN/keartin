import { Module } from "@nestjs/common";
import { GenerateModule } from "../generate/generate.module";
import { PostsController } from "./posts.controller";
import { PostsService } from "./posts.service";

@Module({
  imports: [GenerateModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
