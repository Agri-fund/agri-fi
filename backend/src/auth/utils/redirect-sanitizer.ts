import { BadRequestException } from '@nestjs/common';

/**
 * Sanitizes redirect URLs to prevent open redirect vulnerabilities.
 * Only allows relative paths or whitelisted hostnames.
 *
 * @param redirectUrl - The redirect URL to validate
 * @returns The sanitized redirect URL or null if invalid
 * @throws BadRequestException if the redirect URL is malicious
 */
export function sanitizeRedirectUrl(redirectUrl?: string): string | null {
  if (!redirectUrl) {
    return null;
  }

  // Trim whitespace
  const url = redirectUrl.trim();

  // Reject empty strings
  if (!url) {
    return null;
  }

  // Reject URLs starting with double slash (protocol-relative URLs)
  if (url.startsWith('//')) {
    throw new BadRequestException({
      code: 'INVALID_REDIRECT',
      message: 'Redirect URL cannot start with //',
    });
  }

  // Reject URLs with protocol (http:// or https://)
  if (url.startsWith('http://') || url.startsWith('https://')) {
    throw new BadRequestException({
      code: 'INVALID_REDIRECT',
      message: 'Redirect URL must be a relative path',
    });
  }

  // Allow only relative paths starting with /
  if (!url.startsWith('/')) {
    throw new BadRequestException({
      code: 'INVALID_REDIRECT',
      message: 'Redirect URL must start with /',
    });
  }

  // Additional check: prevent backslash-based path traversal
  if (url.includes('\\')) {
    throw new BadRequestException({
      code: 'INVALID_REDIRECT',
      message: 'Redirect URL contains invalid characters',
    });
  }

  // Prevent URL-encoded backslashes
  if (url.includes('%5c') || url.includes('%5C')) {
    throw new BadRequestException({
      code: 'INVALID_REDIRECT',
      message: 'Redirect URL contains invalid characters',
    });
  }

  return url;
}
