import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { User } from '../auth/entities/user.entity';
import { Sep12Service, Sep12PutCustomerRequest, Sep12CustomerResponse } from './sep12.service';

@ApiTags('sep12')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller('kyc')
export class Sep12Controller {
  constructor(private readonly sep12Service: Sep12Service) {}

  @Put('customer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit or update SEP-12 customer identity fields' })
  @ApiBody({
    schema: {
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email_address: { type: 'string' },
        mobile_number: { type: 'string' },
        address: {
          type: 'object',
          properties: {
            city: { type: 'string' },
            country_code: { type: 'string' },
          },
        },
        id_type: { type: 'string' },
        id_number: { type: 'string' },
        id_country_code: { type: 'string' },
        birth_date: { type: 'string', example: '1990-05-20' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Customer record updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async putCustomer(
    @Body() body: Sep12PutCustomerRequest,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const caller = req.user as User;
    return this.sep12Service.putCustomer(caller.id, body);
  }

  @Get('customer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get SEP-12 customer status and identity fields' })
  @ApiResponse({ status: 200, description: 'Customer record' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async getCustomer(@Req() req: Request): Promise<Sep12CustomerResponse> {
    const caller = req.user as User;
    return this.sep12Service.getCustomer(caller.id);
  }

  @Get('customer/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Get a SEP-12 customer by id (admins only; other roles may view themselves)',
  })
  @ApiParam({ name: 'id', description: 'Customer (user) UUID' })
  @ApiResponse({ status: 200, description: 'SEP-12 compliant customer record' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not allowed to view this customer' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async getCustomerById(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Sep12CustomerResponse> {
    const caller = req.user as User;
    return this.sep12Service.getCustomerById(caller, id);
  }
}
