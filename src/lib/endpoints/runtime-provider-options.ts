import type { RuntimeCatalogProvider } from '@/lib/api/endpoints/runtime';
import type { EndpointProtocol, EndpointProviderFamily } from '@/lib/api/types';

export interface RuntimeProviderOption {
  key: string;
  display_name: string;
  family: EndpointProviderFamily;
  protocol: EndpointProtocol;
  compatibility_interface: 'openai_compatible' | 'anthropic_compatible';
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

export function inferProtocol(provider: Pick<RuntimeCatalogProvider, 'provider_key' | 'api'>): EndpointProtocol {
  const key = normalizeKey(provider.provider_key);
  const api = normalizeKey(provider.api ?? '');
  if (key === 'anthropic' || api.includes('anthropic.com')) return 'anthropic_compatible';
  return 'openai_compatible';
}

export function sortRuntimeProviders(
  providers: RuntimeCatalogProvider[],
): RuntimeCatalogProvider[] {
  const topIndex = new Map<string, number>(EXACT_TOP_PRIORITY.map((key, index) => [key, index]));
  const chinaIndex = new Map<string, number>(CHINA_PROVIDER_PRIORITY.map((key, index) => [key, index]));

  return [...providers].sort((a, b) => {
    const aKey = normalizeKey(a.provider_key);
    const bKey = normalizeKey(b.provider_key);
    const aTop = topIndex.get(aKey);
    const bTop = topIndex.get(bKey);
    if (aTop !== undefined || bTop !== undefined) {
      if (aTop === undefined) return 1;
      if (bTop === undefined) return -1;
      return aTop - bTop;
    }

    const aChina = isLikelyChinaProvider(a.provider_key, a.name);
    const bChina = isLikelyChinaProvider(b.provider_key, b.name);
    if (aChina !== bChina) return aChina ? -1 : 1;

    const aChinaRank = chinaIndex.get(aKey);
    const bChinaRank = chinaIndex.get(bKey);
    if (aChina && bChina && (aChinaRank !== undefined || bChinaRank !== undefined)) {
      if (aChinaRank === undefined) return 1;
      if (bChinaRank === undefined) return -1;
      return aChinaRank - bChinaRank;
    }

    return a.name.localeCompare(b.name, 'en-US');
  });
}

export function buildRuntimeProviderOptions(
  providers: RuntimeCatalogProvider[],
): RuntimeProviderOption[] {
  const sorted = sortRuntimeProviders(providers);
  return sorted.map((provider) => {
    const protocol = inferProtocol(provider);
    return {
      key: provider.provider_key,
      display_name: provider.name,
      family: inferProviderFamily(provider.provider_key),
      protocol,
      compatibility_interface: protocol === 'anthropic_compatible' ? 'anthropic_compatible' : 'openai_compatible',
      default_base_url: provider.api ?? '',
    };
  });
}

export const CUSTOM_RUNTIME_PROVIDER_OPTION: RuntimeProviderOption = {
  key: 'custom',
  display_name: 'Custom',
  family: 'custom',
  protocol: 'openai_compatible',
  compatibility_interface: 'openai_compatible',
  default_base_url: '',
};
