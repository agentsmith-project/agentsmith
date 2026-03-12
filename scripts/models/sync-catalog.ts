import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type EndpointCapabilityType =
  | 'chat_completion'
  | 'multimodal_completion'
  | 'embedding'
  | 'rerank'
  | 'image_generation'
  | 'video_generation';

type RawModelRecord = {
  id?: string;
  name?: string;
  family?: string;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  cost?: {
    input?: number;
    output?: number;
  };
  limit?: {
    context?: number;
    output?: number;
  };
};

type RawProviderRecord = {
  id?: string;
  name?: string;
  api?: string;
  doc?: string;
  npm?: string;
  env?: string[];
  models?: Record<string, RawModelRecord>;
};

type RawCatalog = Record<string, RawProviderRecord>;

const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const MODELS_DEV_LOGO_URL = 'https://models.dev/logos';
const OUTPUT_ROOT = resolve(process.cwd(), 'assets/models-catalog');
const RUNTIME_OUTPUT_PATH = resolve(process.cwd(), 'src/lib/endpoints/models-catalog.config.json');
const PUBLIC_LOGO_ROOT = resolve(process.cwd(), 'public/models-catalog/logos');

type CatalogProviderKey =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'minimax'
  | 'kimi'
  | 'google'
  | 'glm'
  | 'alibaba';

const RUNTIME_PROVIDER_MAP: Array<{
  key: CatalogProviderKey;
  display_name: string;
  aliases: string[];
  logo_key: string;
}> = [
  { key: 'openai', display_name: 'OpenAI', aliases: ['openai'], logo_key: 'openai' },
  { key: 'anthropic', display_name: 'Anthropic', aliases: ['anthropic'], logo_key: 'anthropic' },
  { key: 'deepseek', display_name: 'DeepSeek', aliases: ['deepseek'], logo_key: 'deepseek' },
  { key: 'minimax', display_name: 'MiniMax', aliases: ['minimax', 'minimax-cn'], logo_key: 'minimax' },
  { key: 'kimi', display_name: 'Kimi', aliases: ['moonshotai', 'moonshotai-cn'], logo_key: 'moonshotai' },
  { key: 'google', display_name: 'Google', aliases: ['google', 'google-vertex'], logo_key: 'google' },
  { key: 'glm', display_name: 'GLM', aliases: ['zhipuai', 'zai'], logo_key: 'zhipuai' },
  { key: 'alibaba', display_name: 'Alibaba', aliases: ['alibaba', 'alibaba-cn'], logo_key: 'alibaba' },
];

function inferCapabilities(modelId: string, raw: RawModelRecord): EndpointCapabilityType[] {
  const id = modelId.toLowerCase();
  const input = (raw.modalities?.input ?? []).map((item) => item.toLowerCase());
  const output = (raw.modalities?.output ?? []).map((item) => item.toLowerCase());
  const capabilities = new Set<EndpointCapabilityType>();
  const hasTextOutput = output.includes('text');
  const hasTextInput = input.includes('text') || input.length === 0;
  const hasNonTextInput = input.some((item) => ['image', 'audio', 'video', 'file'].includes(item));
  const isEmbeddingModel =
    id.includes('embedding') || output.includes('embedding') || output.includes('embeddings');
  const isRerankModel = id.includes('rerank');

  if (isRerankModel) capabilities.add('rerank');
  if (isEmbeddingModel) {
    capabilities.add('embedding');
  }
  if (output.includes('image') || id.includes('image') || id.includes('imagen') || id.includes('wanx')) {
    capabilities.add('image_generation');
  }
  if (output.includes('video') || id.includes('video') || id.includes('veo')) {
    capabilities.add('video_generation');
  }
  if (!isEmbeddingModel && !isRerankModel && hasTextOutput && hasTextInput) {
    capabilities.add('chat_completion');
  }
  if (!isEmbeddingModel && !isRerankModel && hasTextOutput && hasNonTextInput) {
    capabilities.add('multimodal_completion');
  }

  return [...capabilities];
}

function byProviderAliases<T extends { key: string }>(providers: T[], aliases: string[]): T[] {
  return providers.filter((provider) => aliases.includes(provider.key));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch_failed:${url}:${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchLogo(providerId: string): Promise<string | null> {
  const response = await fetch(`${MODELS_DEV_LOGO_URL}/${encodeURIComponent(providerId)}.svg`);
  if (!response.ok) {
    return null;
  }
  return response.text();
}

async function run(): Promise<void> {
  const rawCatalog = await fetchJson<RawCatalog>(MODELS_DEV_API_URL);
  const providers = Object.entries(rawCatalog).map(([providerId, provider]) => {
    const models = Object.entries(provider.models ?? {}).map(([modelId, model]) => {
      return {
        id: model.id ?? modelId,
        model_id: modelId,
        name: model.name ?? modelId,
        family: model.family,
        capabilities: inferCapabilities(modelId, model),
        modalities: model.modalities ?? { input: [], output: [] },
        limits: model.limit ?? {},
        pricing: model.cost ?? {},
      };
    });

    return {
      provider_id: provider.id ?? providerId,
      key: providerId,
      name: provider.name ?? providerId,
      api: provider.api,
      doc: provider.doc,
      npm: provider.npm,
      env: provider.env ?? [],
      model_count: models.length,
      models,
    };
  });

  const normalized = {
    source: MODELS_DEV_API_URL,
    synced_at: new Date().toISOString(),
    provider_count: providers.length,
    providers,
  };

  await mkdir(OUTPUT_ROOT, { recursive: true });
  await mkdir(resolve(OUTPUT_ROOT, 'logos'), { recursive: true });
  await mkdir(PUBLIC_LOGO_ROOT, { recursive: true });

  await writeFile(
    resolve(OUTPUT_ROOT, 'catalog.normalized.json'),
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf-8',
  );

  const catalogProviders = RUNTIME_PROVIDER_MAP.map((providerDef) => {
    const matchedProviders = byProviderAliases(providers, providerDef.aliases);
    const allModels = matchedProviders.flatMap((provider) => provider.models);
    const seen = new Set<string>();
    const models = allModels
      .filter((model) => model.capabilities.length > 0)
      .filter((model) => {
        if (seen.has(model.model_id)) return false;
        seen.add(model.model_id);
        return true;
      })
      .slice(0, 120)
      .map((model) => ({
        model_id: model.model_id,
        name: model.name,
        capabilities: model.capabilities,
      }));
    return {
      key: providerDef.key,
      display_name: providerDef.display_name,
      logo_path: `/models-catalog/logos/${providerDef.logo_key}.svg`,
      models,
    };
  });

  await writeFile(
    RUNTIME_OUTPUT_PATH,
    `${JSON.stringify(
      {
        source: MODELS_DEV_API_URL,
        generated_at: new Date().toISOString(),
        providers: catalogProviders,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  let logosWritten = 0;
  for (const provider of providers) {
    const logo = await fetchLogo(provider.key);
    if (!logo) {
      continue;
    }
    await writeFile(resolve(OUTPUT_ROOT, 'logos', `${provider.key}.svg`), logo, 'utf-8');
    await writeFile(resolve(PUBLIC_LOGO_ROOT, `${provider.key}.svg`), logo, 'utf-8');
    logosWritten += 1;
  }

  process.stdout.write(
    `[models-catalog] synced providers=${providers.length} logos=${logosWritten} output=${OUTPUT_ROOT}\n`,
  );
}

void run();
