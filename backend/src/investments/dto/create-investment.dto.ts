import { IsString, IsNumber, IsUUID, Min } from 'class-validator';

export class CreateInvestmentDto {
  @IsUUID()
  tradeDealId: string;

  @IsNumber()
  @Min(1)
  tokenAmount: number;
}