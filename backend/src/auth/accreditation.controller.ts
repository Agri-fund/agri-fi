import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { AccreditationService } from './accreditation.service';
import { User } from './entities/user.entity';

class SubmitAccreditationDto {
  @IsIn(['accredited', 'institutional'])
  tier: 'accredited' | 'institutional';

  @IsOptional()
  @IsString()
  documentUrl?: string;
}

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('auth')
@Version('1')
@Controller('auth/accreditation')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth('jwt')
export class AccreditationController {
  constructor(private readonly accreditationService: AccreditationService) {}

  @Post('declare')
  @ApiOperation({
    summary: 'Submit an accreditation self-declaration (investor)',
    description:
      'Allows an investor to submit a self-declaration requesting an upgraded accreditation tier. The submission enters a review queue for admin approval.',
  })
  @ApiBody({ type: SubmitAccreditationDto })
  @ApiResponse({ status: 201, description: 'Declaration submitted and pending review' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async submitDeclaration(
    @Request() req: AuthRequest,
    @Body() dto: SubmitAccreditationDto,
  ) {
    return this.accreditationService.submitDeclaration(
      req.user.id,
      dto.tier,
      dto.documentUrl,
    );
  }
}
