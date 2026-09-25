import { Injectable } from '@nestjs/common';

export { TaxReportFormat } from './dto/tax-report-query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment, InvestmentStatus } from './entities/investment.entity';

export interface TaxReportRow {
  dealName: string;
  investedAmount: string;
  returnReceived: string;
  netGainLoss: string;
  feesUsd: string;
  currency: string;
  closedAt: string;
}

export interface TaxReportData {
  year: number;
  investorId: string;
  rows: TaxReportRow[];
  totals: { currency: string; netGainLoss: number }[];
  generatedAt: string;
  disclaimer: string;
}

@Injectable()
export class TaxReportService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
  ) {}

  async buildReportData(
    investorId: string,
    year: number,
  ): Promise<TaxReportData> {
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end = new Date(`${year + 1}-01-01T00:00:00Z`);

    const investments = await this.investmentRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.tradeDeal', 'deal')
      .where('inv.investorId = :investorId', { investorId })
      .andWhere('inv.status = :status', { status: InvestmentStatus.CONFIRMED })
      .andWhere('inv.createdAt >= :start', { start })
      .andWhere('inv.createdAt < :end', { end })
      .orderBy('inv.createdAt', 'ASC')
      .getMany();

    const rows: TaxReportRow[] = investments.map((inv) => {
      const invested = parseFloat(inv.amountUsd ?? '0');
      const returned = parseFloat(
        ((inv as Record<string, unknown>)['returnAmountUsd'] as string) ?? '0',
      );
      const fees = parseFloat(
        ((inv as Record<string, unknown>)['feesUsd'] as string) ?? '0',
      );
      const net = returned - invested - fees;
      return {
        dealName: inv.tradeDeal?.title ?? inv.tradeDealId,
        investedAmount: invested.toFixed(2),
        returnReceived: returned.toFixed(2),
        netGainLoss: net.toFixed(2),
        feesUsd: fees.toFixed(2),
        currency: 'USD',
        closedAt: inv.createdAt.toISOString().slice(0, 10),
      };
    });

    const totals = [
      {
        currency: 'USD',
        netGainLoss: rows.reduce(
          (sum, r) => sum + parseFloat(r.netGainLoss),
          0,
        ),
      },
    ];

    return {
      year,
      investorId,
      rows,
      totals,
      generatedAt: new Date().toISOString(),
      disclaimer:
        'This report is provided for informational purposes only and does not constitute professional tax advice. Consult a qualified tax advisor.',
    };
  }

  toCsv(report: TaxReportData): string {
    const headers = [
      'Deal Name',
      'Invested Amount (USD)',
      'Return Received (USD)',
      'Net Gain/Loss (USD)',
      'Fees (USD)',
      'Currency',
      'Closed At',
    ];
    const lines = [headers.join(',')];

    for (const row of report.rows) {
      lines.push(
        [
          `"${row.dealName.replace(/"/g, '""')}"`,
          row.investedAmount,
          row.returnReceived,
          row.netGainLoss,
          row.feesUsd,
          row.currency,
          row.closedAt,
        ].join(','),
      );
    }

    for (const total of report.totals) {
      lines.push(
        `"TOTAL (${total.currency})",,,${total.netGainLoss.toFixed(2)},,${total.currency},`,
      );
    }

    lines.push('');
    lines.push(`"${report.disclaimer}"`);
    return lines.join('\r\n');
  }
}
