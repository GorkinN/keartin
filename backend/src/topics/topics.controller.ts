import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { TopicsService } from "./topics.service";

@Controller("topics")
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get()
  list() {
    return this.topics.list();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown) {
    return this.topics.create(body);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string): Promise<void> {
    await this.topics.remove(id);
  }
}
