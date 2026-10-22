import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SocialProofService } from './social-proof.service';

@ApiTags('Social Proof & Community Trust')
@Controller('social-proof')
export class SocialProofController {
  constructor(private readonly socialProofService: SocialProofService) {}

  @Get('testimonials')
  @ApiOperation({ summary: 'List verified investor testimonials & reviews' })
  @ApiQuery({ name: 'dealId', required: false, description: 'Filter by deal UUID' })
  @ApiResponse({ status: 200, description: 'List of investor testimonials' })
  getTestimonials(@Query('dealId') dealId?: string) {
    return this.socialProofService.getTestimonials(dealId);
  }

  @Post('testimonials')
  @ApiOperation({ summary: 'Submit an investor review or testimonial' })
  @ApiResponse({ status: 201, description: 'Testimonial created' })
  submitTestimonial(@Body() dto: any) {
    return this.socialProofService.addTestimonial(dto);
  }

  @Get('success-stories')
  @ApiOperation({ summary: 'Get completed deal success stories with verified ROI' })
  @ApiResponse({ status: 200, description: 'List of completed deal success stories' })
  getSuccessStories() {
    return this.socialProofService.getSuccessStories();
  }

  @Get('forum/threads')
  @ApiOperation({ summary: 'List deal discussion threads' })
  @ApiQuery({ name: 'dealId', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiResponse({ status: 200, description: 'Discussion threads' })
  getThreads(
    @Query('dealId') dealId?: string,
    @Query('category') category?: string,
  ) {
    return this.socialProofService.getForumThreads(dealId, category);
  }

  @Post('forum/threads')
  @ApiOperation({ summary: 'Create a new question or discussion thread' })
  @ApiResponse({ status: 201, description: 'Thread created' })
  createThread(@Body() dto: any) {
    return this.socialProofService.createForumThread(dto);
  }

  @Post('forum/threads/:id/reply')
  @ApiOperation({ summary: 'Reply to a discussion thread' })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiResponse({ status: 201, description: 'Reply posted' })
  replyThread(@Param('id') id: string, @Body() body: any) {
    const res = this.socialProofService.replyToThread(id, body);
    if (!res) throw new NotFoundException(`Thread ${id} not found`);
    return res;
  }

  @Post('forum/threads/:id/upvote')
  @ApiOperation({ summary: 'Upvote a discussion thread' })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiResponse({ status: 200, description: 'Upvote registered' })
  upvoteThread(@Param('id') id: string) {
    const res = this.socialProofService.upvoteThread(id);
    if (!res) throw new NotFoundException(`Thread ${id} not found`);
    return res;
  }

  @Get('trust-analytics')
  @ApiOperation({ summary: 'Get live social proof conversion impact analytics' })
  @ApiResponse({ status: 200, description: 'Conversion uplift and impression metrics' })
  getTrustAnalytics() {
    return this.socialProofService.getTrustAnalytics();
  }

  @Post('trust-analytics/event')
  @ApiOperation({ summary: 'Record a social proof user interaction event' })
  @ApiResponse({ status: 200, description: 'Event recorded and uplift recalculated' })
  recordEvent(@Body('eventType') eventType: string) {
    return this.socialProofService.recordEvent(eventType || 'unknown');
  }
}
