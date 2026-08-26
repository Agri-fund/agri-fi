import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as fs from 'fs';
import * as path from 'path';
import {
  EmailTemplateService,
  SUPPORTED_LOCALES,
} from './email-template.service';

/**
 * Every shipped template paired with the variables it requires. #897
 * mandates rendering each template in each locale and asserting that no
 * untranslated `{{variables}}` remain in the output.
 */
const TEMPLATE_VARS: Record<string, Record<string, unknown>> = {
  welcome: { userName: 'Amara', verifyUrl: 'https://app.agri-fi.com/verify?token=abc' },
  'kyc-approved': { userName: 'Amara' },
  'kyc-rejected': { userName: 'Amara', reason: 'Document unreadable', kycUrl: 'https://app.agri-fi.com/kyc' },
  'investment-confirmed': {
    investorName: 'Chen',
    dealName: 'Cocoa Export Q3',
    amount: '5000.00',
    tokenAmount: 50,
    txId: 'abc123def456',
  },
  'payment-distributed': {
    farmerName: 'Amara',
    dealName: 'Cocoa Export Q3',
    amount: '4851.00',
    txId: 'abc123def456',
  },
  'deal-funded': { farmerName: 'Amara', dealName: 'Cocoa Export Q3', amount: '10000.00' },
  'deal-expired': { farmerName: 'Amara', dealName: 'Coffee Shipment 12' },
  'password-reset': {
    userName: 'Amara',
    resetUrl: 'https://app.agri-fi.com/reset?token=xyz',
    expiresInMinutes: 30,
  },
  'account-lockout': { userName: 'Amara', unlockAt: 'Mon, 24 Aug 2026 10:00:00 GMT' },
  'security-alert': {
    userName: 'Amara',
    ipAddress: '203.0.113.7',
    device: 'Chrome on macOS',
    time: '2026-08-24 09:41 UTC',
    resetUrl: 'https://app.agri-fi.com/reset?token=xyz',
  },
  'deal-digest': {
    farmerName: 'Amara',
    weekRange: '17 – 23 Aug 2026',
    newInvestorCount: 4,
    newInvestorTotal: '1250.00',
    sectionDeals: 'Funding progress',
    sectionMilestones: 'Upcoming milestones this week',
    sectionDocuments: 'Documents awaiting submission',
    sectionActions: 'Action items',
    dealsHtml:
      '<table><tr><td>Cocoa</td><td><svg width="100" height="12"><rect width="80" height="12" fill="#16a34a"/></svg></td></tr></table>',
    milestonesHtml: '<ul><li>Port clearance — Fri 21 Aug</li></ul>',
    documentsHtml: '<p>Export certificate for Coffee Shipment 12</p>',
    actionsHtml: '<p>Upload the warehouse receipt for Cocoa Export Q3.</p>',
    unsubscribeUrl: 'https://app.agri-fi.com/unsubscribe?token=tok',
    unsubscribeLabel: 'Unsubscribe from these emails',
  },
  'co-farmer-invitation': {
    leadFarmerName: 'Amara',
    dealName: 'Cooperative Maize Deal',
    portionPercent: '25.00',
    acceptUrl: 'https://app.agri-fi.com/co-farmers/accept?token=tok',
  },
};

describe('EmailTemplateService (#897)', () => {
  let service: EmailTemplateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailTemplateService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PinoLogger, useValue: { setContext: jest.fn(), warn: jest.fn() } },
      ],
    }).compile();

    service = module.get<EmailTemplateService>(EmailTemplateService);
  });

  it('ships templates for all supported locales', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['en', 'es', 'fr', 'pt', 'sw']);
    for (const locale of SUPPORTED_LOCALES) {
      const dir = path.join(process.cwd(), 'templates', locale);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.readdirSync(dir).filter((f) => f.endsWith('.hbs')).length).toBe(
        Object.keys(TEMPLATE_VARS).length,
      );
    }
  });

  // Core acceptance criterion — render each template in each locale and
  // assert no untranslated {{variables}} remain.
  it('renders every template in every locale without unresolved variables', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [template, vars] of Object.entries(TEMPLATE_VARS)) {
        const rendered = service.render(template, vars, locale);

        expect(rendered.html.trim().length).toBeGreaterThan(0);
        expect(rendered.text.trim().length).toBeGreaterThan(0);

        const unresolved = rendered.html.match(/\{\{\s*[\w.]+\s*\}\}/g);
        expect({
          locale,
          template,
          unresolved,
        }).toEqual({ locale, template, unresolved: null });
      }
    }
  });

  it('renders every template subject line in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const template of Object.keys(TEMPLATE_VARS)) {
        const rendered = service.render(template, TEMPLATE_VARS[template], locale);
        expect(rendered.subject).not.toBe(template);
        expect(rendered.subject.length).toBeGreaterThan(0);
      }
    }
  });

  it('localises content per locale (sanity check on welcome)', () => {
    expect(service.render('welcome', { userName: 'A', verifyUrl: 'u' }, 'en').html).toContain(
      'Verify my email',
    );
    expect(service.render('welcome', { userName: 'A', verifyUrl: 'u' }, 'es').html).toContain(
      'Verificar mi correo',
    );
    expect(service.render('welcome', { userName: 'A', verifyUrl: 'u' }, 'fr').html).toContain(
      'Vérifier mon e-mail',
    );
    expect(service.render('welcome', { userName: 'A', verifyUrl: 'u' }, 'pt').html).toContain(
      'Verificar o meu e-mail',
    );
    expect(service.render('welcome', { userName: 'A', verifyUrl: 'u' }, 'sw').html).toContain(
      'Thibitisha barua pepe yangu',
    );
  });

  it('falls back to English when a locale template file is missing', () => {
    // 'xx' has no directory at all — must resolve to English output.
    const rendered = service.render('welcome', { userName: 'A', verifyUrl: 'u' }, 'xx');
    expect(rendered.html).toContain('Verify my email');
    expect(rendered.subject).toContain('Welcome');
  });

  it('resolves regional locales to their primary subtag (fr-CA → fr)', () => {
    const rendered = service.render('welcome', { userName: 'A', verifyUrl: 'u' }, 'fr-CA');
    expect(rendered.html).toContain('Vérifier mon e-mail');
  });

  it('escapes HTML in double-stache substitutions to prevent injection', () => {
    const rendered = service.render('kyc-rejected', {
      userName: '<script>alert(1)</script>',
      reason: '"quotes" & <tags>',
      kycUrl: 'https://x.test',
    }, 'en');

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('&quot;quotes&quot; &amp; &lt;tags&gt;');
  });

  it('allows raw HTML through triple-stache substitutions', () => {
    const rendered = service.render('deal-digest', TEMPLATE_VARS['deal-digest'], 'en');
    // dealsHtml is injected raw so inline SVG charts survive
    expect(rendered.html).toContain('<svg width="100" height="12">');
  });

  it('substitutes unknown variables as empty strings instead of leaking placeholders', () => {
    const rendered = service.render('account-lockout', {}, 'en');
    expect(rendered.html).not.toMatch(/\{\{[^}]*\}\}/);
  });

  describe('resolveLocale', () => {
    it.each([
      ['en', 'en'],
      ['ES', 'es'],
      ['fr-CA', 'fr'],
      ['pt_BR', 'pt'],
      [null, 'en'],
      ['', 'en'],
      ['de', 'en'],
    ])('maps %p → %p', (input, expected) => {
      expect(service.resolveLocale(input as string)).toBe(expected);
    });
  });
});
