/**
 * Supported token references for Project Settings.
 * Runtime preferences only (MVP).
 */

import type { TokenItem } from './SettingsTokenReference';

export const RUNTIME_PREFERENCES_TOKENS: TokenItem[] = [
  { path: 'locale.language', default: 'en-US', description: 'BCP 47 language code' },
  { path: 'locale.timezone', default: 'UTC', description: 'IANA timezone' },
  { path: 'ai_behavior.tone', default: 'professional', description: 'professional | casual | friendly | formal | technical' },
  { path: 'ai_behavior.verbosity', default: 'balanced', description: 'concise | balanced | detailed' },
  { path: 'shared_context.organization_name', description: 'Organization/company name' },
  { path: 'shared_context.ai_identity', description: 'System prompt / AI identity' },
  { path: 'shared_context.custom_prompts', description: 'Key-value extensions' },
  { path: 'extensions', description: 'Arbitrary extensions (no validation)' },
];
