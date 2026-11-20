import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DidService } from './did.service';
import {
  CreateDidDocumentDto,
  UpdateDidDocumentDto,
  GenerateDidDto,
  IssueCredentialDto,
  PresentCredentialDto,
  RevokeCredentialDto,
} from './dto/did.dto';
import { VerifiablePresentation } from './did.interface';

@Controller('did')
export class DidController {
  constructor(private readonly didService: DidService) {}

  @Post('generate')
  generateDid(@Body() dto: GenerateDidDto) {
    return this.didService.generateDid(dto);
  }

  @Post('credentials/issue')
  issueCredential(@Body() dto: IssueCredentialDto) {
    return this.didService.issueCredential(dto);
  }

  @Post('credentials/present')
  presentCredential(@Body() dto: PresentCredentialDto) {
    return this.didService.presentCredential(dto);
  }

  @Post('credentials/verify')
  verifyPresentation(@Body() presentation: VerifiablePresentation) {
    return this.didService.verifyPresentation(presentation);
  }

  @Post('credentials/revoke')
  revokeCredential(@Body() dto: RevokeCredentialDto) {
    return this.didService.revokeCredential(dto);
  }

  @Get('credentials/status/:id')
  getCredentialStatus(@Param('id') id: string) {
    return this.didService.getCredentialStatus(id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  createDid(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateDidDocumentDto,
  ) {
    return this.didService.createDid(dto, userId);
  }

  @Get(':did')
  @UseGuards(AuthGuard('jwt'))
  getDid(@Param('did') did: string) {
    return this.didService.getDid(did);
  }

  @Put(':did')
  @UseGuards(AuthGuard('jwt'))
  updateDid(
    @Param('did') did: string,
    @Body() dto: UpdateDidDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.didService.updateDid(did, dto, userId);
  }

  @Delete(':did')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateDid(
    @Param('did') did: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.didService.deactivateDid(did, userId);
  }
}
