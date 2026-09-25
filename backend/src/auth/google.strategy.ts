import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID', 'google-oauth-disabled'),
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET', 'google-oauth-disabled'),
      callbackURL: config.get<string>(
        'GOOGLE_CALLBACK_URL',
        `${config.get<string>('APP_BASE_URL', 'http://localhost:3001')}/v1/auth/google/callback`,
      ),
      scope: ['email', 'profile'],
      session: false,
    });
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
  ): { subject: string; email: string; emailVerified: boolean } {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      throw new Error('Google account did not provide an email address.');
    }

    return {
      subject: profile.id,
      email: email.toLowerCase(),
      emailVerified: profile._json.email_verified === true,
    };
  }
}
