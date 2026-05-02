import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ReleaseMilestoneDto {
  @ApiProperty({ description: 'Zero-based milestone index', example: 0 })
  @IsInt()
  @Min(0)
  milestoneIndex: number;
}
