import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import { Response } from 'express';
import { MetricsIpGuard } from './metrics-ip.guard';

/**
 * Exposes GET /metrics in the Prometheus text exposition format.
 *
 * The endpoint is protected by MetricsIpGuard which restricts access to
 * addresses listed in the METRICS_ALLOWED_IPS environment variable.
 * By default only loopback addresses are permitted, meaning external
 * traffic is blocked and only internal Prometheus scrapers can reach it.
 */
@Controller('metrics')
@UseGuards(MetricsIpGuard)
export class MetricsController extends PrometheusController {
  @Get()
  async index(@Res({ passthrough: true }) response: Response): Promise<string> {
    return super.index(response);
  }
}
