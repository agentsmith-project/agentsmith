import { decodeJwt } from 'jose';

export interface AccessTokenClaims {
  sub?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

export function readAccessTokenClaims(accessToken: string): AccessTokenClaims | null {
  try {
    const claims = decodeJwt(accessToken) as AccessTokenClaims;
    return claims.sub ? claims : null;
  } catch {
    return null;
  }
}
