import type { ModelCatalogProvider } from '@/lib/api/endpoints/model-config';
import type { EndpointProviderFamily, EndpointUpstreamProtocol } from '@/lib/api/types';

export interface ModelCatalogProviderOption {
  key: string;
  display_name: string;
  family: EndpointProviderFamily;
  upstream_protocol: EndpointUpstreamProtocol;
  default_base_url: string;
}

const EXACT_TOP_PRIORITY = ['openai', 'anthropic'] as const;

const CHINA_PROVIDER_PRIORITY = [
  'zhipuai',
  'moonshotai',
  'deepseek',
  'qwen',
  'alibaba',
  'baidu',
  'tencent-hunyuan',
  'minimax',
  'siliconflow',
  'volcengine',
] as const;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function getProviderKey(provider: ModelCatalogProvider): string {
  return provider.provider_key ?? provider.provider_id ?? provider.provider;
}

function getProviderName(provider: ModelCatalogProvider): string {
  return provider.label ?? provider.name ?? provider.provider;
}

function getProviderApi(provider: ModelCatalogProvider): string {
  return provider.api ?? provider.default_base_url ?? '';
}

function fallbackProviderBaseUrl(providerKey: string, displayName: string): string {
  const key = normalizeKey(providerKey);
  const name = normalizeKey(displayName);
  if (key === 'openai' || name.includes('openai')) return 'https://api.openai.com/v1';
  if (key === 'anthropic' || name.includes('anthropic')) return 'https://api.anthropic.com/v1';
  if (key.includes('deepseek') || name.includes('deepseek')) return 'https://api.deepseek.com';
  if (key.includes('moonshot') || key === 'kimi' || name.includes('moonshot') || name.includes('kimi')) {
    return 'https://api.moonshot.cn/v1';
  }
  if (key.includes('zhipu') || key === 'glm' || name.includes('zhipu') || name.includes('glm')) {
    return 'https://open.bigmodel.cn/api/coding/paas/v4';
  }
  if (key.includes('google') || name.includes('google')) {
    return 'https://generativelanguage.googleapis.com/v1beta/openai';
  }
  if (key.includes('qwen') || key.includes('dashscope') || name.includes('qwen') || name.includes('dashscope')) {
    return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }
  return '';
}

function isLikelyChinaProvider(key: string, name: string): boolean {
  const composite = `${normalizeKey(key)} ${normalizeKey(name)}`;
  return [
    'zhipu',
    'moonshot',
    'kimi',
    'deepseek',
    'qwen',
    'alibaba',
    'aliyun',
    'baidu',
    'hunyuan',
    'tencent',
    'minimax',
    'siliconflow',
    'volcengine',
    'spark',
    'iflytek',
    'stepfun',
    'baichuan',
    'modelscope',
    'glm',
  ].some((token) => composite.includes(token));
}

export function inferProviderFamily(providerKey: string): EndpointProviderFamily {
  const key = normalizeKey(providerKey);
  if (key === 'openai') return 'openai';
  if (key === 'anthropic') return 'anthropic';
  if (key === 'deepseek') return 'deepseek';
  if (key === 'minimax') return 'minimax';
  if (key === 'google' || key.startsWith('google')) return 'google';
  if (key === 'moonshotai' || key === 'kimi') return 'kimi';
  if (key === 'zhipuai' || key === 'glm') return 'glm';
  if (key === 'alibaba' || key.includes('dashscope') || key === 'qwen') return 'alibaba';
  return 'custom';
}

export function inferProtocol(provider: { provider_key?: string; api?: string }): EndpointUpstreamProtocol {
  const key = normalizeKey(provider.provider_key ?? '');
  const api = normalizeKey(provider.api ?? '');
  if (key === 'anthropic' || api.includes('anthropic.com')) return 'anthropic_messages';
  return 'openai_chat_completions';
}

export function sortModelCatalogProviders(
  providers: ModelCatalogProvider[],
): ModelCatalogProvider[] {
  const topIndex = new Map<string, number>(EXACT_TOP_PRIORITY.map((key, index) => [key, index]));
  const chinaIndex = new Map<string, number>(CHINA_PROVIDER_PRIORITY.map((key, index) => [key, index]));

  return [...providers].sort((a, b) => {
    const aKey = normalizeKey(getProviderKey(a));
    const bKey = normalizeKey(getProviderKey(b));
    const aTop = topIndex.get(aKey);
    const bTop = topIndex.get(bKey);
    if (aTop !== undefined || bTop !== undefined) {
      if (aTop === undefined) return 1;
      if (bTop === undefined) return -1;
      return aTop - bTop;
    }

    const aChina = isLikelyChinaProvider(getProviderKey(a), getProviderName(a));
    const bChina = isLikelyChinaProvider(getProviderKey(b), getProviderName(b));
    if (aChina !== bChina) return aChina ? -1 : 1;

    const aChinaRank = chinaIndex.get(aKey);
    const bChinaRank = chinaIndex.get(bKey);
    if (aChina && bChina && (aChinaRank !== undefined || bChinaRank !== undefined)) {
      if (aChinaRank === undefined) return 1;
      if (bChinaRank === undefined) return -1;
      return aChinaRank - bChinaRank;
    }

    return getProviderName(a).localeCompare(getProviderName(b), 'en-US');
  });
}

export function buildModelCatalogProviderOptions(
  providers: ModelCatalogProvider[],
): ModelCatalogProviderOption[] {
  const sorted = sortModelCatalogProviders(providers);
  return sorted.map((provider) => {
    const providerKey = getProviderKey(provider);
    const providerName = getProviderName(provider);
    const api = getProviderApi(provider).trim();
    const protocol = inferProtocol({
      provider_key: provider.provider_key ?? providerKey,
      api: provider.api ?? api,
    });
    return {
      key: providerKey,
      display_name: providerName,
      family: provider.family && provider.family !== 'custom'
        ? provider.family as EndpointProviderFamily
        : inferProviderFamily(providerKey),
      upstream_protocol: protocol,
      default_base_url: api || fallbackProviderBaseUrl(providerKey, providerName),
    };
  });
}

export const CUSTOM_MODEL_CATALOG_PROVIDER_OPTION: ModelCatalogProviderOption = {
  key: 'custom',
  display_name: 'Custom',
  family: 'custom',
  upstream_protocol: 'openai_chat_completions',
  default_base_url: '',
};
