export interface UserAPIKey {
  id: string;
  user_id: string;
  key_prefix: string;
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  note?: string;
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}

export interface CreateUserKeyResponse extends UserAPIKey {
  key?: string;
}

export type UserExternalConnectionProvider = 'feishu' | 'jira' | 'github' | 'gitee' | 'custom';

export type UserExternalConnectionKind = 'oauth_account' | 'secret_bundle' | 'ssh_keypair';

export type UserExternalConnectionStatus = 'active' | 'expired' | 'reauth_required' | 'error';

export type UserExternalConnectionReauthReason =
  | 'missing_scopes'
  | 'refresh_failed'
  | 'refresh_token_missing'
  | 'oauth_not_configured'
  | 'unknown';

export interface UserExternalConnectionField {
  key: string;
  description?: string | null;
  secret: boolean;
  masked_value?: string | null;
}

export interface UserExternalConnectionFieldInput {
  key: string;
  value: string;
  description?: string | null;
  secret?: boolean;
}

export interface UserExternalConnectionAccountIdentity {
  external_user_id?: string | null;
  external_name?: string | null;
  external_email?: string | null;
  tenant_id?: string | null;
}

export interface UserExternalConnection {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  provider: UserExternalConnectionProvider;
  custom_domain?: string | null;
  kind: UserExternalConnectionKind;
  display_name: string;
  note?: string | null;
  status: UserExternalConnectionStatus;
  fields: UserExternalConnectionField[];
  account_identity?: UserExternalConnectionAccountIdentity | null;
  scopes?: string[] | null;
  expires_at?: string | null;
  last_refreshed_at?: string | null;
  last_used_at?: string | null;
  last_error?: string | null;
  reauth_reason?: UserExternalConnectionReauthReason | null;
  missing_scopes?: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserExternalConnectionRequest {
  provider: UserExternalConnectionProvider;
  custom_domain?: string;
  kind: UserExternalConnectionKind;
  display_name: string;
  note?: string | null;
  status?: UserExternalConnectionStatus;
  fields?: UserExternalConnectionFieldInput[];
  account_identity?: UserExternalConnectionAccountIdentity;
  scopes?: string[];
  expires_at?: string | null;
  last_error?: string | null;
  reauth_reason?: UserExternalConnectionReauthReason | null;
  missing_scopes?: string[] | null;
}

export interface UpdateUserExternalConnectionRequest {
  custom_domain?: string | null;
  display_name?: string;
  note?: string | null;
  status?: UserExternalConnectionStatus;
  fields?: UserExternalConnectionFieldInput[];
  account_identity?: UserExternalConnectionAccountIdentity | null;
  scopes?: string[] | null;
  expires_at?: string | null;
  last_error?: string | null;
  reauth_reason?: UserExternalConnectionReauthReason | null;
  missing_scopes?: string[] | null;
}

export interface UserExternalConnectionProviderConfig {
  provider: UserExternalConnectionProvider;
  interactive_login_required: boolean;
  refresh_supported: boolean;
  auth_configured?: boolean;
  callback_uri?: string | null;
  auth_url?: string | null;
  scope_policy?: 'full' | 'custom';
  requested_scopes?: string[];
  required_scopes?: string[];
}

export interface UserExternalConnectionOAuthStartResponse {
  authorization_url: string;
  state: string;
  redirect_uri: string;
  expires_at: string;
  scopes?: string[];
}
