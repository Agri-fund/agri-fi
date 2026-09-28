import { Injectable } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { User } from '../auth/entities/user.entity';

/**
 * Helper service to fan out SMS notifications for specific events
 * (milestone and escrow events) to opted-in farmers.
 */
@Injectable()
export class SmsNotificationHelper {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Sends SMS to farmer when a deal milestone is reached/updated
   * @param farmer The farmer user receiving the notification
   * @param dealName Name of the deal
   * @param milestone The milestone reached (e.g., "50% funded", "100% funded", "Ready for shipment")
   * @param dealId Deal ID for cross-reference in logs
   */
  async notifyMilestoneReached(
    farmer: User,
    dealName: string,
    milestone: string,
    dealId: string,
  ): Promise<void> {
    if (!farmer.phone) {
      return;
    }

    const message = `${dealName}: ${milestone}. Check your dashboard for details.`;

    await this.notificationsService.sendSMS(farmer.id, farmer.phone, message, {
      notificationType: 'deal_update',
      channel: 'sms',
      eventType: 'milestone',
      dealId,
    });
  }

  /**
   * Sends SMS to farmer when escrow is settled/paid out
   * @param farmer The farmer user receiving the notification
   * @param dealName Name of the deal
   * @param amount Amount settled (in USDC or local currency)
   * @param dealId Deal ID for cross-reference
   */
  async notifyEscrowSettled(
    farmer: User,
    dealName: string,
    amount: string,
    dealId: string,
  ): Promise<void> {
    if (!farmer.phone) {
      return;
    }

    const message = `Escrow settled for ${dealName}: ${amount} USDC. Transfer initiated to your wallet.`;

    await this.notificationsService.sendSMS(farmer.id, farmer.phone, message, {
      notificationType: 'payment_distributed',
      channel: 'sms',
      eventType: 'escrow_settled',
      dealId,
    });
  }

  /**
   * Sends SMS to farmer when escrow is released but payment is pending
   * @param farmer The farmer user receiving the notification
   * @param dealName Name of the deal
   * @param dealId Deal ID for cross-reference
   */
  async notifyEscrowReleased(
    farmer: User,
    dealName: string,
    dealId: string,
  ): Promise<void> {
    if (!farmer.phone) {
      return;
    }

    const message = `Payment for ${dealName} has been released from escrow. Check your notifications for details.`;

    await this.notificationsService.sendSMS(farmer.id, farmer.phone, message, {
      notificationType: 'payment_distributed',
      channel: 'sms',
      eventType: 'escrow_released',
      dealId,
    });
  }

  /**
   * Sends SMS to farmer when a deal reaches a specific funding percentage
   * @param farmer The farmer user receiving the notification
   * @param dealName Name of the deal
   * @param fundingPercentage Funding percentage (e.g., 25, 50, 75, 100)
   * @param dealId Deal ID for cross-reference
   */
  async notifyFundingMilestone(
    farmer: User,
    dealName: string,
    fundingPercentage: number,
    dealId: string,
  ): Promise<void> {
    if (!farmer.phone) {
      return;
    }

    const message = `Great news! ${dealName} is now ${fundingPercentage}% funded.${fundingPercentage === 100 ? ' Shipment will begin shortly.' : ''}`;

    await this.notificationsService.sendSMS(farmer.id, farmer.phone, message, {
      notificationType: 'deal_update',
      channel: 'sms',
      eventType: 'funding_milestone',
      dealId,
      fundingPercentage,
    });
  }
}
