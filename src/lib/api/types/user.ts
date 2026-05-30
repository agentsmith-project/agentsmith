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

export type UserExternalConnectionProvider = 'custom';

export type UserExternalConnectionKind = 'secret_bundle';

export type UserExternalConnectionStatus = 'active' | 'expired' | 'reauth_required' | 'error';

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

export interface UserExternalConnection {
  id: string;
  user_id: string;
  provider: UserExternalConnectionProvider;
  custom_domain?: string | null;
  kind: UserExternalConnectionKind;
  display_name: string;
  note?: string | null;
  status: UserExternalConnectionStatus;
  fields: UserExternalConnectionField[];
  last_used_at?: string | null;
  last_error?: string | null;
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
  last_error?: string | null;
}

export interface UpdateUserExternalConnectionRequest {
  custom_domain?: string | null;
  display_name?: string;
  note?: string | null;
  status?: UserExternalConnectionStatus;
  fields?: UserExternalConnectionFieldInput[];
  last_error?: string | null;
}
