import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

export interface Sep38QuoteRequest {
  sell_asset: string;
  buy_asset: string;
  sell_amount?: string;
  buy_amount?: string;
}

export interface Sep38QuoteResponse {
  id: string;
  expires_at: string;
  price: string;
  sell_asset: string;
  buy_asset: string;
  sell_amount: string;
  buy_amount: string;
  fee: {
    total: string;
    asset: string;
  };
}

const QUOTE_TTL_SECONDS = 60;
const BPS_DIVISOR = 10_000;

@Injectable()
export class Sep38Service {
  private readonly platformFeeBps: number;
  private readonly usdcIssuer: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(Sep38Service.name);
    this.platformFeeBps = this.config.get<number>('SEP38_FEE_BPS', 30);
    this.usdcIssuer = this.config.get<string>(
      'USDC_ISSUER',
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
  }

  async getQuote(req: Sep38QuoteRequest): Promise<Sep38QuoteResponse> {
    const { sell_asset, buy_asset, sell_amount, buy_amount } = req;

    if (!sell_asset || !buy_asset) {
      throw new BadRequestException('sell_asset and buy_asset are required.');
    }
    if ((!sell_amount && !buy_amount) || (sell_amount && buy_amount)) {
      throw new BadRequestException(
        'Provide exactly one of sell_amount or buy_amount.',
      );
    }

    const price = await this.fetchPrice(sell_asset, buy_asset);

    let sellAmt: number;
    let buyAmt: number;

    if (sell_amount) {
      sellAmt = parseFloat(sell_amount);
      if (Number.isNaN(sellAmt) || sellAmt <= 0) {
        throw new BadRequestException('sell_amount must be a positive number.');
      }
      buyAmt = sellAmt * price;
    } else {
      buyAmt = parseFloat(buy_amount!);
      if (Number.isNaN(buyAmt) || buyAmt <= 0) {
        throw new BadRequestException('buy_amount must be a positive number.');
      }
      sellAmt = buyAmt / price;
    }

    const feeAmt = (sellAmt * this.platformFeeBps) / BPS_DIVISOR;
    const netBuyAmt = buyAmt - (feeAmt * price);

    const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();
    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const quote: Sep38QuoteResponse = {
      id: quoteId,
      expires_at: expiresAt,
      price: price.toFixed(7),
      sell_asset,
      buy_asset,
      sell_amount: sellAmt.toFixed(7),
      buy_amount: Math.max(0, netBuyAmt).toFixed(7),
      fee: {
        total: feeAmt.toFixed(7),
        asset: sell_asset,
      },
    };

    this.logger.info({ quoteId, sell_asset, buy_asset, price }, 'SEP-38 quote issued');
    return quote;
  }

  private async fetchPrice(sellAsset: string, buyAsset: string): Promise<number> {
    const xlmUsdcPair =
      (sellAsset.startsWith('native') && buyAsset.startsWith('USDC')) ||
      (buyAsset.startsWith('native') && sellAsset.startsWith('USDC'));

    if (xlmUsdcPair) {
      return this.config.get<number>('SEP38_XLM_USDC_RATE', 0.1);
    }

    this.logger.warn({ sellAsset, buyAsset }, 'Unsupported asset pair — returning 1:1 price');
    return 1;
  }
}
