import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Request,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { DocumentsService } from './documents.service';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('documents')
@ApiBearerAuth('jwt')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload a trade document (PDF/PNG/JPEG, max 10 MB)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'doc_type', 'trade_deal_id'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file (PDF, PNG, or JPEG)',
        },
        doc_type: { type: 'string', example: 'bill_of_lading' },
        trade_deal_id: {
          type: 'string',
          example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Document uploaded to IPFS and anchored on Stellar',
  })
  @ApiResponse({
    status: 400,
    description: 'Missing file, unsupported type, or file too large',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { doc_type: string; trade_deal_id: string },
    @Request() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('File is required');
    if (file.size > 10 * 1024 * 1024)
      throw new BadRequestException('File exceeds 10 MB limit');
    if (
      !['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimetype)
    ) {
      throw new BadRequestException(
        'Unsupported file type. Only PDF, PNG, JPEG allowed',
      );
    }
    return this.documentsService.handleUpload({
      file,
      docType: body.doc_type,
      tradeDealId: body.trade_deal_id,
      userId: req.user.id,
    });
  }
}
