# SMS Notifications Feature

## Overview

SMS notifications enable farmers on feature phones to receive critical updates about their deals even without smartphone access. The system supports two providers (AfricasTalking and Twilio) with configurable daily rate limits and user preference controls.

## Architecture

### Provider Pattern

Three SMS provider implementations are available:

1. **TwilioProvider** - Uses Twilio API for global SMS delivery
   - Configuration: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
   
2. **AfricasTalkingProvider** - Uses AfricasTalking API (optimized for African markets)
   - Configuration: `AFRICAS_TALKING_API_KEY`, `AFRICAS_TALKING_USERNAME`

3. **FakeSmsProvider** - Test/development provider that captures messages for assertions
   - Default provider; used in test environments

### Core Services

#### `NotificationsService`
Extended with SMS support:
```typescript
async sendSMS(
  userId: string,
  phone: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void>
```

Checks:
- SMS enabled globally (`NOTIFICATIONS_SMS_ENABLED=true`)
- User has opted-in (`notification_preferences.sms_enabled=true`)
- Daily rate limit not exceeded (`SMS_DAILY_CAP_PER_USER`)

#### `SmsRateLimiterService`
Tracks SMS count per user per calendar day using the `notification_entity.metadataJson.channel='sms'` marker.

Enforces daily cap (default: 10 SMSs/day/user, configurable via `SMS_DAILY_CAP_PER_USER`).

#### `NotificationPreferencesService`
Extended to handle SMS channel:
- `isChannelEnabled(userId, notificationType, 'sms')` - checks if SMS is enabled for a notification type
- `updatePreference()` accepts optional `smsEnabled` field

#### `SmsNotificationHelper`
High-level helper for common notification scenarios:
- `notifyMilestoneReached()` - deal milestone updates
- `notifyFundingMilestone()` - funding percentage milestones (25%, 50%, 75%, 100%)
- `notifyEscrowReleased()` - escrow released notification
- `notifyEscrowSettled()` - escrow settled with amount

## Configuration

### Environment Variables

```bash
# Enable/disable SMS feature
NOTIFICATIONS_SMS_ENABLED=true

# SMS provider selection
NOTIFICATIONS_SMS_PROVIDER=africas_talking  # Options: africas_talking, twilio, fake

# Daily cap per user (default: 10)
SMS_DAILY_CAP_PER_USER=10

# AfricasTalking (if provider=africas_talking)
AFRICAS_TALKING_API_KEY=your-api-key
AFRICAS_TALKING_USERNAME=your-username

# Twilio (if provider=twilio)
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

### User Preferences

Notification preferences include SMS channel:
```typescript
interface NotificationPreference {
  userId: string;
  notificationType: string;  // e.g. 'deal_update', 'payment_distributed'
  emailEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  smsEnabled: boolean;  // NEW
}
```

Preferences are seeded with defaults (all true) on first access.

## Database

### Migration

`AddSmsEnabledToNotificationPreferences1950000000002` adds the `sms_enabled` column to `notification_preferences` table.

### Notification Tracking

SMS sends are recorded with:
```typescript
{
  userId: string;
  type: 'alert';  // or 'payment', 'kyc', 'deal'
  title: string;
  message: string;
  metadataJson: {
    channel: 'sms';
    eventType: 'milestone' | 'escrow_settled' | 'escrow_released' | 'funding_milestone';
    dealId: string;
    notificationType: string;
  };
  createdAt: Date;
}
```

## Security & Privacy

1. **Phone Masking**: All logs mask phone numbers (e.g., `****5678`)
2. **Encryption at Rest**: User phone numbers stored encrypted (AES-256-GCM) in `users.phone`
3. **Decryption at Send**: Decrypted only when sending (not in logs)
4. **Rate Limiting**: Daily cap prevents spam/abuse
5. **Preference Enforcement**: Users can opt-out per notification type

## Usage Examples

### 1. Send SMS for Milestone Event

```typescript
import { SmsNotificationHelper } from './sms-notification-helper';

constructor(private smsNotificationHelper: SmsNotificationHelper) {}

async onMilestoneReached(farmer: User, deal: TradeDeal) {
  await this.smsNotificationHelper.notifyMilestoneReached(
    farmer,
    deal.name,
    'Ready for shipment',
    deal.id
  );
}
```

### 2. Send SMS for Escrow Settlement

```typescript
async onEscrowSettled(farmer: User, deal: TradeDeal, amount: string) {
  await this.smsNotificationHelper.notifyEscrowSettled(
    farmer,
    deal.name,
    amount,
    deal.id
  );
}
```

### 3. Send SMS for Funding Milestone

```typescript
async onFundingUpdate(farmer: User, deal: TradeDeal, fundingPct: number) {
  if (fundingPct === 50 || fundingPct === 100) {
    await this.smsNotificationHelper.notifyFundingMilestone(
      farmer,
      deal.name,
      fundingPct,
      deal.id
    );
  }
}
```

### 4. Manual SMS Send with Preference Check

```typescript
const isEnabled = await this.notificationPreferencesService.isChannelEnabled(
  userId,
  'deal_update',
  'sms'
);

if (isEnabled && user.phone) {
  await this.notificationsService.sendSMS(
    userId,
    user.phone,
    'Your message here',
    { notificationType: 'deal_update', channel: 'sms' }
  );
}
```

## Testing

### Fake Provider for Unit Tests

```typescript
// In test module setup
import { FakeSmsProvider } from './providers/fake-sms.provider';

const smsProvider = new FakeSmsProvider();
await smsProvider.sendSMS({ phone: '+254712345678', message: 'Test' });

const messages = smsProvider.getSentMessages();
expect(messages).toHaveLength(1);
expect(messages[0].phone).toBe('+254712345678');

smsProvider.clearSentMessages();  // Reset between tests
```

### Integration Tests

```typescript
// Test rate limiting
jest.spyOn(smsRateLimiter, 'isWithinDailyLimit').mockResolvedValue(false);
await notificationsService.sendSMS(userId, phone, message);
expect(logger.warn).toHaveBeenCalledWith(
  expect.objectContaining({ message: /daily cap/ })
);

// Test preference enforcement
jest.spyOn(preferencesService, 'isChannelEnabled').mockResolvedValue(false);
await notificationsService.sendSMS(userId, phone, message, { notificationType: 'deal_update' });
expect(logger.debug).toHaveBeenCalled();

// Verify SMS was sent in real environment
const messages = fakeProvider.getSentMessages();
expect(messages[0].message).toContain('expected text');
```

## Monitoring & Logging

All SMS operations are logged with masking:
```
[INFO] Successfully sent SMS to ***5678
[WARN] SMS daily cap reached for user user-123
[DEBUG] SMS notifications disabled for user user-456, type deal_update
[ERROR] Failed to send SMS to ***5678: API error
```

## Acceptance Criteria - Implementation Status

✅ SMS provider abstraction with 2 implementations
- `SmsProvider` interface
- `TwilioProvider` implementation
- `AfricasTalkingProvider` implementation
- `FakeSmsProvider` for testing

✅ Milestone + escrow events send SMS to opted-in farmers
- `SmsNotificationHelper` with methods for milestone and escrow events
- `NotificationsService.sendSMS()` integrated with preferences
- Database schema extended with `sms_enabled` column

✅ Daily cap enforced; fake-provider tests
- `SmsRateLimiterService` tracks daily SMS count
- Rate limit checked before send
- `FakeSmsProvider` captures messages for test assertions
- Comprehensive test suite in `notifications-sms.service.spec.ts`

## Future Enhancements

1. **SMS Templates**: Create per-locale SMS message templates (like email templates)
2. **Two-Way SMS**: Support SMS commands for actions (e.g., "APPROVE" to confirm)
3. **SMS Delivery Reports**: Track delivery status via provider webhooks
4. **Bulk SMS**: Fan out to multiple farmers at once
5. **A/B Testing**: Test different message formats
