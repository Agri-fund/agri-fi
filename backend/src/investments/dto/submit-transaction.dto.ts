import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitTransactionDto {
  @IsString()
  @IsNotEmpty()
  signedXdr: string;
}