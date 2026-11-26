import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../auth/entities/user.entity';
import { DisputesService } from './disputes.service';
import {
  CreateDisputeDto,
  DisputeResponseDto,
  ResolveDisputeDto,
} from './dto/dispute.dto';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('disputes')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ path: 'disputes', version: '1' })
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  @Roles('investor')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Investor raises an escrow dispute for an undelivered shipment (#1387)',
  })
  @ApiResponse({
    status: 201,
    description: 'Dispute created and deal marked DISPUTED',
    type: DisputeResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({
    status: 403,
    description: 'Only confirmed deal investors may raise a dispute',
  })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  @ApiResponse({
    status: 422,
    description: 'Dispute eligibility rules not met',
  })
  async createDispute(
    @Request() req: AuthRequest,
    @Body() dto: CreateDisputeDto,
  ): Promise<DisputeResponseDto> {
    return this.disputesService.createDispute(req.user.id, dto);
  }

  @Get()
  @Roles('investor', 'farmer', 'trader', 'admin', 'compliance_officer')
  @ApiOperation({ summary: 'List escrow disputes visible to the current user' })
  @ApiResponse({
    status: 200,
    description: 'List of disputes',
    type: [DisputeResponseDto],
  })
  async findAll(@Request() req: AuthRequest): Promise<DisputeResponseDto[]> {
    return this.disputesService.findAll(req.user);
  }

  @Get(':id')
  @Roles('investor', 'farmer', 'trader', 'admin', 'compliance_officer')
  @ApiOperation({ summary: 'Get details of a specific dispute' })
  @ApiParam({ name: 'id', description: 'Dispute UUID' })
  @ApiResponse({
    status: 200,
    description: 'Dispute details',
    type: DisputeResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Dispute not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthRequest,
  ): Promise<DisputeResponseDto> {
    return this.disputesService.findOne(id, req.user);
  }

  @Post(':id/evidence')
  @Roles('investor', 'farmer', 'trader', 'admin', 'compliance_officer')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload evidence document for a dispute via DocumentsService',
  })
  @ApiParam({ name: 'id', description: 'Dispute UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Evidence document (PDF, PNG, or JPEG)',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Evidence uploaded and attached to dispute',
    type: DisputeResponseDto,
  })
  async uploadEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthRequest,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<DisputeResponseDto> {
    return this.disputesService.uploadEvidence(
      id,
      req.user.id,
      req.user.role,
      file,
    );
  }

  @Patch(':id/review')
  @Roles('admin', 'compliance_officer')
  @ApiOperation({ summary: 'Admin marks a dispute as UNDER_REVIEW' })
  @ApiParam({ name: 'id', description: 'Dispute UUID' })
  @ApiResponse({
    status: 200,
    description: 'Dispute moved to UNDER_REVIEW',
    type: DisputeResponseDto,
  })
  async startReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthRequest,
  ): Promise<DisputeResponseDto> {
    return this.disputesService.startReview(id, req.user.id);
  }

  @Post(':id/resolve')
  @Roles('admin', 'compliance_officer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Admin resolves dispute: release escrow to farmer or refund investors',
  })
  @ApiParam({ name: 'id', description: 'Dispute UUID' })
  @ApiResponse({
    status: 200,
    description: 'Dispute resolved and escrow settled accordingly',
    type: DisputeResponseDto,
  })
  async resolveDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthRequest,
    @Body() dto: ResolveDisputeDto,
  ): Promise<DisputeResponseDto> {
    return this.disputesService.resolveDispute(id, req.user.id, dto);
  }
}
