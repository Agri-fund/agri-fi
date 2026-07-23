import { Controller, Get, Res } from '@nestjs/common';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import { Response } from 'express';

// Exposes GET /metrics in the Prometheus text exposition format. Subclassing the
// library controller lets us own the route (and add guards later if needed)
// instead of relying on the module's auto-registered default controller.
@Controller('metrics')
export class MetricsController extends PrometheusController {
  @Get()
  async index(@Res({ passthrough: true }) response: Response): Promise<string> {
    return super.index(response);
  }
}
