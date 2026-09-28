import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import PDFDocument from 'pdfkit';

export interface InvoiceData {
  invoiceNumber: string;
  investorName: string;
  investorId: string;
  dealName: string;
  dealId: string;
  amountUsd: string;
  platformFeeUsd: string;
  netAmountUsd: string;
  currency: string;
  disbursementDate: string;
  dueDate: string;
  recipientType: string;
  walletAddress: string;
}

@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(PaymentDistribution)
    private readonly paymentDistributionRepo: Repository<PaymentDistribution>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
  ) {}

  async getInvoiceData(
    paymentDistributionId: string,
    investorId: string,
  ): Promise<InvoiceData> {
    const paymentDistribution =
      await this.paymentDistributionRepo.findOne({
        where: { id: paymentDistributionId },
        relations: ['tradeDeal'],
      });

    if (!paymentDistribution) {
      throw new Error('Payment distribution not found');
    }

    if (paymentDistribution.recipientId !== investorId) {
      throw new Error('Unauthorized access to invoice');
    }

    const platformFeePercent = 0.02; // 2% platform fee
    const amountUsd = parseFloat(paymentDistribution.amountUsd.toString());
    const platformFeeUsd = amountUsd * platformFeePercent;
    const netAmountUsd = amountUsd - platformFeeUsd;

    return {
      invoiceNumber: `INV-${paymentDistributionId.substring(0, 8).toUpperCase()}`,
      investorName: `Investor ${investorId.substring(0, 8)}`,
      investorId,
      dealName: paymentDistribution.tradeDeal?.title || 'Unknown Deal',
      dealId: paymentDistribution.tradeDealId,
      amountUsd: amountUsd.toFixed(2),
      platformFeeUsd: platformFeeUsd.toFixed(2),
      netAmountUsd: netAmountUsd.toFixed(2),
      currency: 'USD',
      disbursementDate: paymentDistribution.createdAt.toISOString().split('T')[0],
      dueDate: new Date(
        paymentDistribution.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .split('T')[0],
      recipientType: paymentDistribution.recipientType,
      walletAddress: paymentDistribution.walletAddress,
    };
  }

  generateInvoicePdf(data: InvoiceData, locale: string = 'en'): Buffer {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('INVOICE', 50, 50);
    doc
      .fontSize(12)
      .font('Helvetica')
      .text(`Invoice Number: ${data.invoiceNumber}`, 50, 80);
    doc.text(`Date: ${data.disbursementDate}`, 50, 100);
    doc.text(`Due Date: ${data.dueDate}`, 50, 120);

    // Investor Info
    doc.fontSize(14).font('Helvetica-Bold').text('Bill To:', 50, 160);
    doc.fontSize(12).font('Helvetica').text(data.investorName, 50, 180);
    doc.text(`ID: ${data.investorId}`, 50, 200);
    doc.text(`Wallet: ${data.walletAddress}`, 50, 220);

    // Deal Info
    doc.fontSize(14).font('Helvetica-Bold').text('Deal Information:', 300, 160);
    doc.fontSize(12).font('Helvetica').text(`Deal: ${data.dealName}`, 300, 180);
    doc.text(`Deal ID: ${data.dealId}`, 300, 200);

    // Line items
    const tableTop = 280;
    doc.fontSize(12).font('Helvetica-Bold');

    // Table header
    doc.text('Description', 50, tableTop);
    doc.text('Amount', 400, tableTop);

    doc.moveTo(50, tableTop + 20).lineTo(550, tableTop + 20).stroke();

    // Table rows
    doc.fontSize(12).font('Helvetica');
    doc.text('Disbursement Amount', 50, tableTop + 40);
    doc.text(`${data.amountUsd} ${data.currency}`, 400, tableTop + 40);

    doc.text('Platform Fee (2%)', 50, tableTop + 60);
    doc.text(`${data.platformFeeUsd} ${data.currency}`, 400, tableTop + 60);

    doc.moveTo(50, tableTop + 80).lineTo(550, tableTop + 80).stroke();

    // Total
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('Net Amount', 50, tableTop + 100);
    doc.text(
      `${data.netAmountUsd} ${data.currency}`,
      400,
      tableTop + 100,
    );

    // Footer
    doc.fontSize(10).font('Helvetica');
    doc.text(
      'This invoice is generated automatically by Agri-Fi Platform.',
      50,
      700,
    );
    doc.text(
      'For questions, contact support@agri-fi.com',
      50,
      720,
    );

    doc.end();

    return Buffer.concat(chunks);
  }
}
