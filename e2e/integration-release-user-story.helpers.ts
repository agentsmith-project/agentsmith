export type ReleaseStoryIdpVerifyResponse = {
  idp_ok?: boolean;
  directory_search_supported?: boolean;
  advice_code?: string;
};

export function resolveReleaseStoryAdminMode(
  payload: ReleaseStoryIdpVerifyResponse | null | undefined,
): 'directory_user' | 'email_pending' {
  return payload?.directory_search_supported === true ? 'directory_user' : 'email_pending';
}
