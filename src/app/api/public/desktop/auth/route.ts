import { NextResponse } from 'next/server';
import { readPublicRuntimeConfigFromEnv } from '@/lib/public-runtime-config';
import { resolveKeycloakRealmBase } from '@/lib/auth/keycloak';

export async function GET(request: Request) {
  const config = readPublicRuntimeConfigFromEnv(process.env);
  const issuer = resolveKeycloakRealmBase(config.keycloakUrl, config.keycloakRealm);
  if (!issuer || !config.keycloakClientId.trim()) {
    return NextResponse.json(
      {
        error_code: 'DESKTOP_AUTH_NOT_CONFIGURED',
        error_message: 'desktop_auth_not_configured',
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    deployment_base_url: new URL(request.url).origin,
    issuer,
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: `${issuer}/protocol/openid-connect/token`,
    client_id: config.keycloakClientId.trim(),
    scopes: ['openid', 'profile', 'email'],
    response_type: 'code',
    pkce_method: 'S256',
    suggested_callback_origin: 'http://127.0.0.1',
    suggested_callback_path: '/desktop/auth/callback',
  });
}
