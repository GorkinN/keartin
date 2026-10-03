import { BadGatewayException, Controller, Get } from "@nestjs/common";
import { PythonClient, PythonRequestError } from "../ai/python.client";

@Controller("config")
export class ConfigController {
  constructor(private readonly python: PythonClient) {}

  @Get()
  async getConfig() {
    try {
      return await this.python.appConfig();
    } catch (error) {
      if (error instanceof PythonRequestError) throw new BadGatewayException(error.message);
      throw error;
    }
  }
}
