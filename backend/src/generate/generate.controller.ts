import { Body, Controller, Get, HttpCode, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { GenerateService } from "./generate.service";

@Controller("generate")
export class GenerateController {
  constructor(private readonly generate: GenerateService) {}

  @Post("posts")
  @HttpCode(202)
  start(@Body() body: unknown) {
    return this.generate.start(body);
  }

  @Get("posts/:id/events")
  events(@Param("id") id: string, @Res() res: Response) {
    return this.generate.events(id, res);
  }
}
