export const FULL_FEISHU_USER_OAUTH_SCOPES = [
  'bitable:app',
  'bitable:app:readonly',
  'board:whiteboard:node:create',
  'board:whiteboard:node:delete',
  'board:whiteboard:node:read',
  'board:whiteboard:node:update',
  'contact:contact.base:readonly',
  'contact:user.base:readonly',
  'contact:user:search',
  'docs:doc',
  'docs:doc:readonly',
  'docs:document.comment:create',
  'docs:document.comment:read',
  'docs:document.comment:update',
  'docs:document.comment:write_only',
  'docs:document.content:read',
  'docs:document.media:download',
  'docs:document.media:upload',
  'docs:document.subscription',
  'docs:document.subscription:read',
  'docs:document:copy',
  'docs:document:export',
  'docs:document:import',
  'docs:event.document_deleted:read',
  'docs:event.document_edited:read',
  'docs:event.document_opened:read',
  'docs:event:subscribe',
  'docs:permission.member',
  'docs:permission.member:auth',
  'docs:permission.member:create',
  'docs:permission.member:delete',
  'docs:permission.member:readonly',
  'docs:permission.member:retrieve',
  'docs:permission.member:transfer',
  'docs:permission.member:update',
  'docs:permission.setting',
  'docs:permission.setting:read',
  'docs:permission.setting:readonly',
  'docs:permission.setting:write_only',
  'docx:document',
  'docx:document.block:convert',
  'docx:document:create',
  'docx:document:readonly',
  'docx:document:write_only',
  'drive:drive',
  'drive:drive.metadata:readonly',
  'drive:drive.search:readonly',
  'drive:drive:readonly',
  'drive:drive:version',
  'drive:drive:version:readonly',
  'drive:export:readonly',
  'drive:file',
  'drive:file.like:readonly',
  'drive:file.meta.sec_label.read_only',
  'drive:file:download',
  'drive:file:readonly',
  'drive:file:upload',
  'drive:file:view_record:readonly',
  'offline_access',
  'search:docs:read',
  'sheets:spreadsheet',
  'sheets:spreadsheet.meta:read',
  'sheets:spreadsheet.meta:write_only',
  'sheets:spreadsheet:create',
  'sheets:spreadsheet:read',
  'sheets:spreadsheet:readonly',
  'sheets:spreadsheet:write_only',
  'slides:presentation:create',
  'slides:presentation:read',
  'slides:presentation:update',
  'slides:presentation:write_only',
  'space:document.event:read',
  'space:document:delete',
  'space:document:move',
  'space:document:retrieve',
  'space:document:shortcut',
  'space:folder:create',
  'wiki:member:create',
  'wiki:member:retrieve',
  'wiki:member:update',
  'wiki:node:copy',
  'wiki:node:create',
  'wiki:node:move',
  'wiki:node:read',
  'wiki:node:retrieve',
  'wiki:node:update',
  'wiki:setting:read',
  'wiki:setting:write_only',
  'wiki:space:read',
  'wiki:space:retrieve',
  'wiki:space:write_only',
  'wiki:wiki',
  'wiki:wiki:readonly',
] as const;

const FEISHU_DOCS_REQUIRED_SCOPES = [
  'search:docs:read',
  'wiki:wiki',
  'wiki:wiki:readonly',
  'wiki:node:retrieve',
] as const;

export type FeishuOAuthScopePolicy = 'full' | 'custom';
export const FEISHU_MISSING_REQUIRED_SCOPES_ERROR_PREFIX = 'feishu_missing_required_scopes:';

function parseScopeList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getFeishuOAuthScopePolicy(): FeishuOAuthScopePolicy {
  const configuredPolicy = process.env.FEISHU_OAUTH_SCOPE_POLICY?.trim().toLowerCase();
  if (configuredPolicy === 'custom') return 'custom';
  if (configuredPolicy === 'full') return 'full';
  return process.env.FEISHU_OAUTH_SCOPES?.trim() ? 'custom' : 'full';
}

export function getRequestedFeishuOAuthScopes(): string[] {
  const policy = getFeishuOAuthScopePolicy();
  if (policy === 'custom') {
    const configured = process.env.FEISHU_OAUTH_SCOPES?.trim();
    if (configured) {
      return parseScopeList(configured);
    }
  }
  return [...FULL_FEISHU_USER_OAUTH_SCOPES];
}

export function getCanonicalFeishuOAuthScopes(): string[] {
  return getRequestedFeishuOAuthScopes();
}

export function getRequiredFeishuDocsScopes(): string[] {
  return [...FEISHU_DOCS_REQUIRED_SCOPES];
}

export function normalizeFeishuScopeString(scope: string | null | undefined): string[] | null {
  if (!scope?.trim()) return null;
  return parseScopeList(scope);
}

export function findMissingFeishuDocsScopes(scopes: readonly string[] | null | undefined): string[] {
  const current = new Set((scopes ?? []).map((item) => item.trim()).filter(Boolean));
  return FEISHU_DOCS_REQUIRED_SCOPES.filter((scope) => !current.has(scope));
}

export function buildFeishuMissingScopesError(missingScopes: readonly string[]): string | null {
  if (missingScopes.length === 0) return null;
  return `${FEISHU_MISSING_REQUIRED_SCOPES_ERROR_PREFIX}${missingScopes.join(',')}`;
}
