import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { promises as dns } from 'dns';
import { EmailCategory, EmailMessage, EmailPreference } from './entities/email.entities';
import { EmailTemplatesService } from './email-templates.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../auth/entities/user.entity';
import { Document } from '../trade-deals/entities/document.entity';

const SECRET = () => process.env.EMAIL_LINK_SECRET || process.env.JWT_SECRET || 'dev-email-secret';
const API_URL = () => process.env.API_PUBLIC_URL || 'http://localhost:3001';
const APP_URL = () => process.env.FRONTEND_URL || 'http://localhost:3000';
const REPLY_DOMAIN = () => process.env.EMAIL_REPLY_DOMAIN || 'reply.agri-fi.app';
const MAIL_DOMAIN = () => process.env.EMAIL_DOMAIN || 'agri-fi.app';
/** Categories that can never be unsubscribed from (security / legal). */
const TRANSACTIONAL: EmailCategory[] = ['kyc', 'alert'];

export const sign = (data: string) => createHmac('sha256', SECRET()).update(data).digest('base64url');
export const verify = (data: string, sig: string) => {
  const a = Buffer.from(sign(data));
  const b = Buffer.from(sig || '');
  return a.length === b.length && timingSafeEqual(a, b);
};

export interface QueueEmailInput {
  userId?: string;
  to?: string;
  template: string;
  category: EmailCategory;
  vars: Record<string, any>;
  /** Explicit schedule; otherwise derived from user preferences. */
  sendAt?: Date;
  allowReply?: boolean;
  context?: Record<string, any>;
}

@Injectable()
export class EmailIntegrationService {
  private readonly logger = new Logger(EmailIntegrationService.name);

  constructor(
    @InjectRepository(EmailMessage) private readonly messages: Repository<EmailMessage>,
    @InjectRepository(EmailPreference) private readonly prefs: Repository<EmailPreference>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    private readonly templates: EmailTemplatesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------- Preferences ----------------
  async getPreferences(userId: string): Promise<EmailPreference> {
    return (await this.prefs.findOne({ where: { userId } })) ??
      this.prefs.create({ userId, frequency: 'instant', categories: {}, preferredHour: null, timezone: 'UTC', unsubscribedAll: false });
  }

  async updatePreferences(userId: string, dto: Partial<EmailPreference>): Promise<EmailPreference> {
    const current = await this.getPreferences(userId);
    if (dto.frequency && !['instant', 'daily', 'weekly', 'off'].includes(dto.frequency)) throw new BadRequestException('Invalid frequency');
    if (dto.preferredHour != null && (dto.preferredHour < 0 || dto.preferredHour > 23)) throw new BadRequestException('preferredHour must be 0-23');
    if (dto.timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: dto.timezone }); } catch { throw new BadRequestException('Invalid timezone'); }
    }
    Object.assign(current, {
      frequency: dto.frequency ?? current.frequency,
      categories: { ...current.categories, ...(dto.categories ?? {}) },
      preferredHour: dto.preferredHour !== undefined ? dto.preferredHour : current.preferredHour,
      timezone: dto.timezone ?? current.timezone,
      unsubscribedAll: dto.unsubscribedAll ?? current.unsubscribedAll,
    });
    return this.prefs.save(current);
  }

  private allowed(p: EmailPreference, category: EmailCategory): boolean {
    if (TRANSACTIONAL.includes(category)) return true;
    if (p.unsubscribedAll || p.frequency === 'off') return false;
    return p.categories[category] !== false;
  }

  // ---------------- Scheduling ----------------
  /** Next occurrence of `hour` in `tz` (optionally on the next Monday for weekly). */
  nextSlot(hour: number, tz: string, weekly = false, from = new Date()): Date {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: 'numeric', weekday: 'short' }).formatToParts(from);
    const localHour = Number(parts.find((p) => p.type === 'hour')!.value) % 24;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')!.value);
    let addHours = (hour - localHour + 24) % 24 || (weekly ? 0 : 24);
    if (weekly) {
      const targetDay = (1 - weekday + 7) % 7; // Monday
      addHours += targetDay * 24;
      if (addHours <= 0) addHours += 7 * 24;
    }
    const d = new Date(from.getTime() + addHours * 3600_000);
    d.setUTCMinutes(0, 0, 0);
    return d;
  }

  private scheduleFor(p: EmailPreference, category: EmailCategory, explicit?: Date): Date {
    if (explicit) return explicit;
    if (TRANSACTIONAL.includes(category) || p.frequency === 'instant') {
      return p.preferredHour != null && category === 'marketing' ? this.nextSlot(p.preferredHour, p.timezone) : new Date();
    }
    return this.nextSlot(p.preferredHour ?? 9, p.timezone, p.frequency === 'weekly');
  }

  // ---------------- Links ----------------
  unsubscribeUrl(userId: string, category?: EmailCategory) {
    const data = `${userId}:${category ?? 'all'}`;
    return `${API_URL()}/v1/email/unsubscribe?t=${Buffer.from(data).toString('base64url')}.${sign(data)}`;
  }

  private trackLinks(html: string, messageId: string): string {
    const withClicks = html.replace(/href="(https?:\/\/[^"]+)"/g, (m, url) => {
      if (url.includes('/v1/email/unsubscribe')) return m;
      const u = Buffer.from(url).toString('base64url');
      return `href="${API_URL()}/v1/email/track/click/${messageId}?u=${u}&s=${sign(messageId + url)}"`;
    });
    const pixel = `<img src="${API_URL()}/v1/email/track/open/${messageId}.gif" width="1" height="1" alt="" style="display:none">`;
    return withClicks.includes('</body>') ? withClicks.replace('</body>', `${pixel}</body>`) : withClicks + pixel;
  }

  // ---------------- Queue / send ----------------
  async queue(input: QueueEmailInput): Promise<EmailMessage | null> {
    let to = input.to;
    let name = input.vars.name;
    if (input.userId) {
      const user = await this.users.findOne({ where: { id: input.userId } });
      if (!user) throw new NotFoundException('User not found');
      to ??= user.email;
      name ??= user.email.split('@')[0];
    }
    if (!to) throw new BadRequestException('Recipient required');
    const p = input.userId ? await this.getPreferences(input.userId) : null;

    const msg = this.messages.create({
      userId: input.userId ?? null,
      toAddress: to,
      template: input.template,
      category: input.category,
      subject: '', html: '', text: '',
      status: p && !this.allowed(p, input.category) ? 'suppressed' : 'scheduled',
      scheduledFor: p ? this.scheduleFor(p, input.category, input.sendAt) : input.sendAt ?? new Date(),
      replyToken: input.allowReply ? randomBytes(16).toString('hex') : null,
      context: input.context ?? null,
    });
    const saved = await this.messages.save(msg);
    const rendered = this.templates.render(input.template, {
      ...input.vars,
      name,
      unsubscribeUrl: input.userId ? this.unsubscribeUrl(input.userId, input.category) : `${APP_URL()}/settings/notifications`,
      preferencesUrl: `${APP_URL()}/settings/notifications`,
    });
    saved.subject = rendered.subject;
    saved.text = rendered.text;
    saved.html = this.trackLinks(rendered.html, saved.id);
    await this.messages.save(saved);
    if (saved.status === 'scheduled' && saved.scheduledFor <= new Date()) await this.deliver(saved);
    return saved;
  }

  private async deliver(m: EmailMessage) {
    try {
      // Existing notification infrastructure (SendGrid / SES SMTP transport).
      await this.notifications.sendEmail(m.toAddress, m.subject, m.text, m.html, {
        replyTo: this.replyAddress(m),
        headers: m.userId
          ? {
              'List-Unsubscribe': `<${this.unsubscribeUrl(m.userId, m.category)}>, <mailto:unsubscribe@${MAIL_DOMAIN()}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              'X-Agri-Fi-Message-Id': m.id,
            }
          : { 'X-Agri-Fi-Message-Id': m.id },
      });
      m.status = 'sent';
      m.sentAt = new Date();
    } catch (e: any) {
      m.status = 'failed';
      m.error = e?.message ?? String(e);
      this.logger.error(`Email ${m.id} failed: ${m.error}`);
    }
    await this.messages.save(m);
  }

  /** Delivers due scheduled emails; daily/weekly users get one digest instead of many emails. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async processScheduled(): Promise<number> {
    const due = await this.messages.find({
      where: { status: 'scheduled', scheduledFor: LessThanOrEqual(new Date()) },
      order: { scheduledFor: 'ASC' },
      take: 500,
    });
    const byUser = new Map<string, EmailMessage[]>();
    const singles: EmailMessage[] = [];
    for (const m of due) {
      if (m.userId && m.template === 'notification') (byUser.get(m.userId) ?? byUser.set(m.userId, []).get(m.userId)!).push(m);
      else singles.push(m);
    }
    for (const m of singles) await this.deliver(m);
    for (const [userId, list] of byUser) {
      const p = await this.getPreferences(userId);
      if (list.length === 1 || p.frequency === 'instant') { for (const m of list) await this.deliver(m); continue; }
      const digest = await this.queue({
        userId, template: 'digest', category: 'deal', sendAt: new Date(),
        vars: {
          period: p.frequency === 'weekly' ? 'weekly' : 'daily',
          count: list.length,
          items: list.map((m) => `<p><strong>${m.subject.replace(/</g, '&lt;')}</strong></p>`).join(''),
          itemsText: list.map((m) => `• ${m.subject}`).join('\n'),
        },
      });
      await this.messages.update({ id: In(list.map((m) => m.id)) }, { status: 'sent', sentAt: new Date(), context: { digestId: digest?.id } as any });
    }
    return due.length;
  }

  /** Sends the price-alert email to the alert owner when a threshold is crossed. */
  async sendPriceAlertEmail(
    userId: string,
    alert: { commodity: string; thresholdPrice: number; direction: 'ABOVE' | 'BELOW' },
    currentPrice: number,
  ): Promise<EmailMessage | null> {
    const directionLabel = alert.direction === 'ABOVE' ? 'risen above' : 'fallen below';
    return this.queue({
      userId,
      category: 'alert',
      template: 'price_alert',
      sendAt: new Date(),
      allowReply: true,
      vars: {
        commodity: alert.commodity,
        direction: alert.direction,
        directionLabel,
        thresholdPrice: alert.thresholdPrice,
        currentPrice,
        triggeredAt: new Date().toUTCString(),
        linkUrl: `${APP_URL()}/market/${encodeURIComponent(alert.commodity)}`,
      },
      context: { commodity: alert.commodity, thresholdPrice: alert.thresholdPrice, direction: alert.direction, currentPrice },
    });
  }

  /** Email + in-platform notification in one call. */
  async notify(userId: string, category: EmailCategory, title: string, message: string, linkUrl?: string, actionRequired = false) {
    if (['payment', 'kyc', 'deal', 'alert'].includes(category)) {
      await this.notifications.createNotification({ userId, type: category as any, title, message, linkUrl });
    }
    return this.queue({
      userId, category,
      template: actionRequired ? 'action_required' : 'notification',
      vars: { title, message, linkUrl: linkUrl ? `${APP_URL()}${linkUrl}` : APP_URL() },
      allowReply: true,
      context: { linkUrl, actionRequired },
    });
  }

  // ---------------- Document sharing ----------------
  async shareDocument(documentId: string, sender: { id: string; role: string }, recipients: string[], message = '', expiresInHours = 72) {
    if (!recipients?.length || recipients.length > 20) throw new BadRequestException('1-20 recipients required');
    const doc = await this.documents.findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.uploaderId !== sender.id && !['admin', 'compliance'].includes(sender.role)) throw new ForbiddenException('Cannot share this document');
    const senderUser = await this.users.findOne({ where: { id: sender.id } });
    const expires = Date.now() + expiresInHours * 3600_000;
    const data = `${documentId}:${expires}`;
    const documentUrl = `${API_URL()}/v1/email/shared/${documentId}?e=${expires}&s=${sign(data)}`;
    const out: EmailMessage[] = [];
    for (const to of recipients) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new BadRequestException(`Invalid email: ${to}`);
      const recipient = await this.users.findOne({ where: { email: to } });
      const m = await this.queue({
        userId: recipient?.id, to, template: 'document_share', category: 'document', sendAt: new Date(),
        vars: {
          senderName: senderUser?.email ?? 'A user', docType: doc.docType, dealRef: doc.tradeDealId.slice(0, 8),
          message, documentUrl, ipfsHash: doc.ipfsHash, expiresAt: new Date(expires).toUTCString(),
        },
        context: { documentId, sharedBy: sender.id },
      });
      if (m) out.push(m);
    }
    await this.audit.logEvent({
      actorId: sender.id, actorRole: sender.role, route: 'email.document.shared', statusCode: 200,
      requestDetails: { documentId, recipients, expiresInHours },
    });
    return { shared: out.length, expiresAt: new Date(expires) };
  }

  async resolveSharedDocument(documentId: string, expires: number, sig: string): Promise<string> {
    if (!verify(`${documentId}:${expires}`, sig)) throw new ForbiddenException('Invalid link');
    if (Date.now() > expires) throw new ForbiddenException('Link expired');
    const doc = await this.documents.findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException();
    return doc.storageUrl;
  }

  // ---------------- Tracking / analytics ----------------
  async trackOpen(id: string) {
    await this.messages.createQueryBuilder().update()
      .set({ openCount: () => 'open_count + 1', openedAt: () => 'COALESCE(opened_at, now())' })
      .where('id = :id', { id }).execute().catch(() => undefined);
  }

  async trackClick(id: string, encodedUrl: string, sig: string): Promise<string> {
    const url = Buffer.from(encodedUrl, 'base64url').toString();
    if (!verify(id + url, sig)) throw new ForbiddenException('Invalid link');
    await this.messages.createQueryBuilder().update()
      .set({ clickCount: () => 'click_count + 1', openedAt: () => 'COALESCE(opened_at, now())' })
      .where('id = :id', { id }).execute();
    return url;
  }

  async analytics(days = 30) {
    const rows = await this.messages.createQueryBuilder('m')
      .select('m.template', 'template')
      .addSelect(`COUNT(*) FILTER (WHERE m.status = 'sent')::int`, 'sent')
      .addSelect(`COUNT(*) FILTER (WHERE m.status = 'failed')::int`, 'failed')
      .addSelect(`COUNT(*) FILTER (WHERE m.status = 'suppressed')::int`, 'suppressed')
      .addSelect(`COUNT(*) FILTER (WHERE m.open_count > 0)::int`, 'opened')
      .addSelect(`COUNT(*) FILTER (WHERE m.click_count > 0)::int`, 'clicked')
      .where(`m.created_at > now() - (:days || ' days')::interval`, { days })
      .groupBy('m.template')
      .getRawMany();
    const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k]), 0);
    const sent = sum('sent');
    return {
      periodDays: days,
      sent, failed: sum('failed'), suppressed: sum('suppressed'),
      openRate: sent ? sum('opened') / sent : 0,
      clickRate: sent ? sum('clicked') / sent : 0,
      clickToOpenRate: sum('opened') ? sum('clicked') / sum('opened') : 0,
      byTemplate: rows.map((r) => ({ ...r, openRate: r.sent ? r.opened / r.sent : 0, clickRate: r.sent ? r.clicked / r.sent : 0 })),
    };
  }

  // ---------------- Unsubscribe ----------------
  async unsubscribe(token: string) {
    const [data64, sig] = (token || '').split('.');
    const data = Buffer.from(data64 || '', 'base64url').toString();
    if (!verify(data, sig)) throw new BadRequestException('Invalid unsubscribe token');
    const [userId, category] = data.split(':');
    if (category === 'all' || TRANSACTIONAL.includes(category as EmailCategory)) {
      await this.updatePreferences(userId, { unsubscribedAll: true });
    } else {
      await this.updatePreferences(userId, { categories: { [category]: false } as any });
    }
    return { userId, category };
  }

  replyAddress(m: EmailMessage) {
    return m.replyToken ? `reply+${m.replyToken}@${REPLY_DOMAIN()}` : undefined;
  }

  // ---------------- Email-to-platform ----------------
  /** Strips quoted history / signatures from a reply body. */
  static extractReply(text: string): string {
    const lines = (text || '').replace(/\r/g, '').split('\n');
    const out: string[] = [];
    for (const l of lines) {
      if (/^>/.test(l) || /^On .+wrote:$/.test(l.trim()) || /^-- ?$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From: /.test(l)) break;
      out.push(l);
    }
    return out.join('\n').trim();
  }

  async processInbound(payload: { to?: string; from?: string; subject?: string; text?: string; SPF?: string; dkim?: string }) {
    const token = payload.to?.match(/reply\+([a-f0-9]{32})@/i)?.[1];
    if (!token) throw new BadRequestException('Unrecognised reply address');
    if (payload.SPF && !/pass/i.test(payload.SPF)) throw new ForbiddenException('SPF check failed');
    if (payload.dkim && !/pass/i.test(payload.dkim)) throw new ForbiddenException('DKIM check failed');
    const original = await this.messages.findOne({ where: { replyToken: token } });
    if (!original || !original.userId) throw new NotFoundException('Original message not found');
    const fromAddr = payload.from?.match(/<([^>]+)>/)?.[1] ?? payload.from ?? '';
    if (fromAddr.toLowerCase() !== original.toAddress.toLowerCase()) throw new ForbiddenException('Sender does not match recipient');

    const body = EmailIntegrationService.extractReply(payload.text ?? '');
    if (!body) throw new BadRequestException('Empty reply');
    const cmd = body.match(/^(APPROVE|REJECT)\b/i)?.[1]?.toUpperCase();
    const comment = cmd ? body.slice(cmd.length).trim() : body;
    const action = cmd === 'APPROVE' ? 'approved' : cmd === 'REJECT' ? 'rejected' : 'commented';

    await this.audit.logEvent({
      actorId: original.userId, actorRole: 'email', route: `email.reply.${action}`, statusCode: 200,
      requestDetails: { messageId: original.id, context: original.context, comment: comment.slice(0, 5000) },
    });
    await this.notifications.createNotification({
      userId: original.userId, type: 'deal',
      title: `Email reply received (${action})`,
      message: comment.slice(0, 280) || action,
      linkUrl: original.context?.linkUrl,
      metadataJson: { source: 'email', action, messageId: original.id, context: original.context },
    });
    original.replyToken = null; // single-use
    await this.messages.save(original);
    return { action, comment, messageId: original.id };
  }

  // ---------------- Email security ----------------
  async checkDomainSecurity(domain = MAIL_DOMAIN()) {
    const txt = async (name: string) => (await dns.resolveTxt(name).catch(() => [])).map((r) => r.join(''));
    const selector = process.env.EMAIL_DKIM_SELECTOR || 's1';
    const [root, dmarc, dkim] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`), txt(`${selector}._domainkey.${domain}`)]);
    const spf = root.find((r) => r.startsWith('v=spf1')) ?? null;
    const dmarcRec = dmarc.find((r) => r.startsWith('v=DMARC1')) ?? null;
    const dkimRec = dkim.find((r) => r.includes('p=')) ?? null;
    return {
      domain,
      spf: { record: spf, ok: !!spf && /[-~]all/.test(spf) },
      dkim: { selector, record: dkimRec ? `${dkimRec.slice(0, 60)}…` : null, ok: !!dkimRec },
      dmarc: { record: dmarcRec, ok: !!dmarcRec && /p=(quarantine|reject)/.test(dmarcRec) },
    };
  }
}
