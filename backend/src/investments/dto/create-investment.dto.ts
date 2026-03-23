import { IsUUID, IsInt, Min } from 'class-validator';

export class CreateInvestmentDto {
  @IsUUID()
  trade_deal_id: string;

  @IsInt()
  @Min(1)
  token_amount: number;
}
