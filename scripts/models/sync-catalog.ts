import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type EndpointCapabilityType =
  | 'chat_completion'
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

function inferCapabilities(modelId: string, raw: RawModelRecord): EndpointCapabilityType[] {
  const id = modelId.toLowerCase();
  const input = raw.modalities?.input ?? [];
  const output = raw.modalities?.output ?? [];
  const capabilities = new Set<EndpointCapabilityType>();

  if (id.includes('rerank')) capabilities.add('rerank');
  if (id.includes('embedding') || output.includes('embedding') || output.includes('embeddings')) {
    capabilities.add('embedding');
  }
  if (output.includes('image') || id.includes('image') || id.includes('imagen') || id.includes('wanx')) {
    capabilities.add('image_generation');
  }
  if (output.includes('video') || id.includes('video') || id.includes('veo')) {
    capabilities.add('video_generation');
  }
  if ((input.includes('text') || input.length === 0) && output.includes('text')) {
    capabilities.add('chat_completion');
  }

  return [...capabilities];
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

  await writeFile(
    resolve(OUTPUT_ROOT, 'catalog.normalized.json'),
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf-8',
  );

  let logosWritten = 0;
  for (const provider of providers) {
    const logo = await fetchLogo(provider.key);
    if (!logo) {
      continue;
    }
    await writeFile(resolve(OUTPUT_ROOT, 'logos', `${provider.key}.svg`), logo, 'utf-8');
    logosWritten += 1;
  }

  process.stdout.write(
    `[models-catalog] synced providers=${providers.length} logos=${logosWritten} output=${OUTPUT_ROOT}\n`,
  );
}

void run();
