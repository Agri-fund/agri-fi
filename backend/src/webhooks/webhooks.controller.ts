import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { WebhookDeliveryService } from './webhook-delivery.service';
import type { WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { WebhooksService } from './webhooks.service';
import {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
} from './dto/create-webhook-subscription.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin/webhooks')
@UseGuards(JwtAuthGuard, AdminGuard)
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly deliveryService: WebhookDeliveryService,
  ) {}

  @Post()
  async create(@Body() dto: CreateWebhookSubscriptionDto) {
    return await this.webhooksService.createSubscription(dto);
  }

  @Get()
  async findAll() {
    return await this.webhooksService.findAllSubscriptions();
  }

  /** Dead letter queue across all subscriptions. */
  @Get('dlq/deliveries')
  async deadLetters(@Query('limit') limit?: string) {
    return await this.deliveryService.listDeadLetters(Number(limit) || 50);
  }

  @Post('deliveries/:deliveryId/replay')
  async replay(@Param('deliveryId') deliveryId: string) {
    return await this.deliveryService.replay(deliveryId);
  }

  @Get(':id/deliveries')
  async deliveries(
    @Param('id') id: string,
    @Query('status') status?: WebhookDeliveryStatus,
    @Query('limit') limit?: string,
  ) {
    await this.webhooksService.findOneSubscription(id);
    return await this.deliveryService.listForSubscription(
      id,
      status,
      Number(limit) || 50,
    );
  }

  @Get(':id/summary')
  async summary(@Param('id') id: string) {
    await this.webhooksService.findOneSubscription(id);
    return await this.deliveryService.summary(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.webhooksService.findOneSubscription(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookSubscriptionDto,
  ) {
    return await this.webhooksService.updateSubscription(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.webhooksService.deleteSubscription(id);
  }
}
