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
} from '@nestjs/common';
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
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  async create(@Body() dto: CreateWebhookSubscriptionDto) {
    return await this.webhooksService.createSubscription(dto);
  }

  @Get()
  async findAll() {
    return await this.webhooksService.findAllSubscriptions();
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
