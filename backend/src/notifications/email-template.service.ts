import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { PinoLogger } from 'nestjs-pino';

/** Locales with translated email templates (#897). */
export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'pt', 'sw'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Renders localized transactional emails from Handlebars/Mustache-style
 * `.hbs` template files (#897).
 *
 * Layout on disk:
 *   templates/{locale}/{templateName}.hbs   — HTML body
 *   templates/i18n/{locale}.json            — translated subject lines
 *
 * Behaviour:
 * - Variable substitution supports `{{var}}` (HTML-escaped) and `{{{var}}}`
 *   (raw, used for pre-built fragments such as SVG charts / table rows).
 * - Falls back to the English template when the requested locale's file is
 *   missing so a partially-translated rollout never breaks delivery.
 */
@Injectable()
export class EmailTemplateService {
  private readonly templatesDir: string;
  private readonly cache = new Map<string, string>();
  private readonly subjectCache = new Map<string, Record<string, string>>();
  private readonly catalogCache = new Map<string, Record<string, any>>();

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EmailTemplateService.name);
    this.templatesDir =
      this.config.get<string>('EMAIL_TEMPLATES_DIR') ??
      path.resolve(process.cwd(), 'templates');
  }

  /** All locales that ship translated templates. */
  getSupportedLocales(): readonly string[] {
    return SUPPORTED_LOCALES;
  }

  /**
   * Resolves the best available locale for a user preference: exact match,
   * otherwise the primary subtag (`fr-CA` → `fr`), otherwise English.
   */
  resolveLocale(preferred?: string | null): SupportedLocale {
    if (!preferred) return DEFAULT_LOCALE;
    const lower = preferred.trim().toLowerCase();
    if ((SUPPORTED_LOCALES as readonly string[]).includes(lower)) {
      return lower as SupportedLocale;
    }
    const primary = lower.split(/[-_]/)[0];
    if ((SUPPORTED_LOCALES as readonly string[]).includes(primary)) {
      return primary as SupportedLocale;
    }
    return DEFAULT_LOCALE;
  }

  /**
   * Renders a template in the requested locale (English fallback).
   *
   * @param templateName e.g. "welcome", "account-lockout", "deal-digest"
   * @param vars         substitution values, e.g. { dealName, amount }
   * @param preferredLanguage user's preferredLanguage column value or null
   */
  render(
    templateName: string,
    vars: Record<string, unknown> = {},
    preferredLanguage?: string | null,
  ): RenderedEmail {
    const locale = this.resolveLocale(preferredLanguage);

    let html: string;
    try {
      html = this.loadTemplate(templateName, locale);
    } catch {
      // Fallback to English when the localized template is missing (#897).
      this.logger.warn(
        { templateName, locale },
        `Missing template "${templateName}" for locale "${locale}" — falling back to English`,
      );
      html = this.loadTemplate(templateName, DEFAULT_LOCALE);
    }

    let subjects = this.loadSubjects(locale);
    if (!subjects[templateName]) {
      subjects = this.loadSubjects(DEFAULT_LOCALE);
    }

    return {
      subject: subjects[templateName] ?? templateName,
      html: this.substitute(html, vars),
      text: this.htmlToText(this.substitute(html, vars)),
    };
  }

  /**
   * Localized section headings for the weekly digest (#892), e.g.
   * { deals: "Funding progress", milestones: "...", ... } — English fallback.
   */
  getSectionHeadings(preferredLanguage?: string | null): {
    deals: string;
    milestones: string;
    documents: string;
    actions: string;
    unsubscribe: string;
  } {
    const locale = this.resolveLocale(preferredLanguage);
    const catalog = this.loadCatalog(locale);
    const english = this.loadCatalog(DEFAULT_LOCALE);

    // Section labels live under "deal-digest.sections" in each i18n file.
    const sections = {
      ...((english['deal-digest']?.sections as Record<string, string>) ?? {}),
      ...((catalog['deal-digest']?.sections as Record<string, string>) ?? {}),
    };

    return {
      deals: sections.deals ?? 'Funding progress',
      milestones: sections.milestones ?? 'Upcoming milestones this week',
      documents: sections.documents ?? 'Documents awaiting submission',
      actions: sections.actions ?? 'Action items',
      unsubscribe: sections.unsubscribe ?? 'Unsubscribe from these emails',
    };
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private templatePath(templateName: string, locale: string): string {
    return path.join(this.templatesDir, locale, `${templateName}.hbs`);
  }

  private loadTemplate(templateName: string, locale: string): string {
    const key = `${locale}/${templateName}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const filePath = this.templatePath(templateName, locale);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const content = fs.readFileSync(filePath, 'utf8');
    this.cache.set(key, content);
    return content;
  }

  private loadSubjects(locale: string): Record<string, string> {
    const cached = this.subjectCache.get(locale);
    if (cached) return cached;

    const catalog = this.loadCatalog(locale);
    const subjects: Record<string, string> = {};
    for (const [template, value] of Object.entries(catalog)) {
      if (value && typeof value === 'object' && 'subject' in value) {
        subjects[template] = String((value as { subject: unknown }).subject);
      }
    }
    this.subjectCache.set(locale, subjects);
    return subjects;
  }

  /** Loads (and caches) the full i18n catalog for a locale. */
  private loadCatalog(locale: string): Record<string, any> {
    const cached = this.catalogCache.get(locale);
    if (cached) return cached;

    try {
      const filePath = path.join(this.templatesDir, 'i18n', `${locale}.json`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.catalogCache.set(locale, parsed);
      return parsed;
    } catch {
      this.logger.warn(
        { locale },
        `No subject translations found for locale "${locale}"`,
      );
      const empty: Record<string, any> = {};
      this.catalogCache.set(locale, empty);
      return empty;
    }
  }

  /**
   * Substitutes `{{var}}` (HTML-escaped) and `{{{var}}}` (raw) placeholders.
   * Unknown variables are replaced with an empty string rather than leaking
   * raw placeholders into delivered mail.
   */
  substitute(template: string, vars: Record<string, unknown>): string {
    return template
      .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, name: string) =>
        this.lookup(vars, name),
      )
      .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) =>
        escapeHtml(this.lookup(vars, name)),
      );
  }

  private lookup(vars: Record<string, unknown>, name: string): string {
    const value = name
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc !== null && acc !== undefined
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        vars as unknown,
      );
    if (value === null || value === undefined) return '';
    return String(value);
  }

  /** Naive tag-stripper used to produce the plain-text alternative body. */
  private htmlToText(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
