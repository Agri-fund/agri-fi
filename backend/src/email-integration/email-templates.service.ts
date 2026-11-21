import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

const LAYOUT = (body: string) => `<!doctype html><html><body style="margin:0;background:#f4f6f3;font-family:Inter,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="600" style="background:#fff;border-radius:12px;padding:32px;color:#1f2a1f">
<tr><td><h2 style="color:#2f6b3a;margin-top:0">{{brand}}</h2>${body}
<hr style="border:none;border-top:1px solid #e4e8e2;margin:24px 0">
<p style="font-size:12px;color:#7a857a">You receive this because of your notification settings.
<a href="{{preferencesUrl}}">Manage preferences</a> · <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>
</td></tr></table></td></tr></table></body></html>`;

const btn = (href: string, label: string) =>
  `<p><a href="${href}" style="background:#2f6b3a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${label}</a></p>`;

/** Built-in templates. Override any of them by placing `<name>.html`, `<name>.txt`
 *  and `<name>.subject` in EMAIL_TEMPLATE_DIR. */
const DEFAULTS: Record<string, EmailTemplate> = {
  notification: {
    subject: '{{title}}',
    html: LAYOUT(`<p>Hi {{name}},</p><p>{{message}}</p>${btn('{{linkUrl}}', 'View on platform')}
<p style="color:#7a857a;font-size:13px">Reply to this email to comment directly on the platform.</p>`),
    text: 'Hi {{name}},\n\n{{message}}\n\nView: {{linkUrl}}\n\nReply to this email to respond.\nUnsubscribe: {{unsubscribeUrl}}',
  },
  document_share: {
    subject: '{{senderName}} shared a document with you',
    html: LAYOUT(`<p>{{senderName}} shared <strong>{{docType}}</strong> for deal {{dealRef}}.</p>
<blockquote style="border-left:3px solid #2f6b3a;padding-left:12px;color:#4a554a">{{message}}</blockquote>
${btn('{{documentUrl}}', 'Open document')}<p style="font-size:12px;color:#7a857a">Link expires {{expiresAt}}. IPFS CID: {{ipfsHash}}</p>`),
    text: '{{senderName}} shared {{docType}} for deal {{dealRef}}.\n\n{{message}}\n\nOpen: {{documentUrl}}\nExpires: {{expiresAt}}',
  },
  action_required: {
    subject: 'Action required: {{title}}',
    html: LAYOUT(`<p>{{message}}</p><p>Reply with <strong>APPROVE</strong> or <strong>REJECT</strong> (optionally followed by a comment), or:</p>
${btn('{{linkUrl}}', 'Review on platform')}`),
    text: '{{message}}\n\nReply APPROVE or REJECT (optionally with a comment), or review at {{linkUrl}}',
  },
  digest: {
    subject: 'Your {{period}} Agri-Fi summary ({{count}} updates)',
    html: LAYOUT(`<p>Hi {{name}}, here is what happened:</p>{{{items}}}${btn('{{appUrl}}', 'Open dashboard')}`),
    text: 'Hi {{name}}, here is what happened:\n\n{{itemsText}}\n\n{{appUrl}}',
  },
  price_alert: {
    subject: 'Price alert: {{commodity}} is {{direction}} your target of {{thresholdPrice}}',
    html: LAYOUT(`<p>Hi {{name}},</p>
<p><strong>{{commodity}}</strong> is now trading at <strong>{{currentPrice}}</strong>, which is {{direction}} your alert threshold of <strong>{{thresholdPrice}}</strong>.</p>
${btn('{{linkUrl}}', 'View market')}
<p style="font-size:13px;color:#7a857a">{{recurringNote}}</p>`),
    text: 'Hi {{name}},\n\n{{commodity}} is now trading at {{currentPrice}}, which is {{direction}} your alert threshold of {{thresholdPrice}}.\n\n{{recurringNote}}\n\nView market: {{linkUrl}}\nUnsubscribe: {{unsubscribeUrl}}',
  },
};

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Injectable()
export class EmailTemplatesService {
  private readonly dir = process.env.EMAIL_TEMPLATE_DIR;

  list(): string[] {
    return Object.keys(DEFAULTS);
  }

  get(name: string): EmailTemplate {
    const base = DEFAULTS[name];
    if (!base) throw new Error(`Unknown email template: ${name}`);
    if (!this.dir) return base;
    const read = (ext: string) => {
      const f = join(this.dir!, `${name}.${ext}`);
      return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
    };
    return { subject: read('subject')?.trim() ?? base.subject, html: read('html') ?? base.html, text: read('txt') ?? base.text };
  }

  /** Mustache-style rendering: {{var}} is HTML-escaped (in html), {{{var}}} is raw. */
  render(name: string, vars: Record<string, any>): EmailTemplate {
    const t = this.get(name);
    const all = { brand: 'Agri-Fi', appUrl: process.env.FRONTEND_URL ?? '', ...vars };
    const sub = (s: string, html: boolean) =>
      s
        .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => String(all[k] ?? ''))
        .replace(/\{\{(\w+)\}\}/g, (_, k) => (html ? escape(String(all[k] ?? '')) : String(all[k] ?? '')));
    return { subject: sub(t.subject, false), html: sub(t.html, true), text: sub(t.text, false) };
  }
}
