import type { ApiClient } from './client';
import { getApiClient } from './client';

export interface RefreshAuthResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function refreshAuth(
  refreshToken: string,
  client: ApiClient = getApiClient(),
): Promise<RefreshAuthResponse> {
  return client.post<RefreshAuthResponse>('/v1/auth/refresh', {
    refresh_token: refreshToken,
  });
}
