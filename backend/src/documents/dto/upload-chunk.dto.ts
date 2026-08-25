import { IsString, IsInt, IsUUID, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadChunkDto {
  @ApiProperty({ description: 'Unique file identifier for the upload session' })
  @IsString()
  fileId: string;

  @ApiProperty({ description: 'Zero-based chunk index' })
  @IsInt()
  @Min(0)
  chunkIndex: number;

  @ApiProperty({ description: 'Total number of chunks' })
  @IsInt()
  @Min(1)
  totalChunks: number;

  @ApiProperty({ description: 'Document type' })
  @IsString()
  docType: string;

  @ApiProperty({ description: 'Trade deal UUID' })
  @IsUUID()
  tradeDealId: string;
}

export class UploadCompleteDto {
  @ApiProperty({ description: 'Unique file identifier matching the chunked upload session' })
  @IsString()
  fileId: string;

  @ApiProperty({ description: 'Document type' })
  @IsString()
  docType: string;

  @ApiProperty({ description: 'Trade deal UUID' })
  @IsUUID()
  tradeDealId: string;

  @ApiProperty({ description: 'Original file name' })
  @IsString()
  fileName: string;

  @ApiProperty({ description: 'MIME type of the file' })
  @IsString()
  mimeType: string;
}
