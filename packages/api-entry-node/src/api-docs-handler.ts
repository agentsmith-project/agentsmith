import { readFileSync } from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { fileURLToPath } from 'node:url';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SOURCE_DIR, '../../..');
const CONTRACT_SPECS_DIR = path.join(REPO_ROOT, 'docs', 'contracts', 'specs');
const SWAGGER_DIST_DIR = path.join(REPO_ROOT, 'node_modules', 'swagger-ui-dist');

type ApiSpecName = 'openapi' | 'asyncapi';

const specCache: Partial<Record<ApiSpecName, unknown>> = {};
const swaggerAssetCache: Record<string, Buffer> = {};

function readJsonSpec(name: ApiSpecName): unknown {
  const cached = specCache[name];
  if (cached) {
    return cached;
  }
  const content = readFileSync(path.join(CONTRACT_SPECS_DIR, `${name}.json`), 'utf-8');
  const parsed = JSON.parse(content) as unknown;
  specCache[name] = parsed;
  return parsed;
}

function getSwaggerAsset(assetName: string): Buffer {
  const cached = swaggerAssetCache[assetName];
  if (cached) {
    return cached;
  }
  const fullPath = path.join(SWAGGER_DIST_DIR, assetName);
  const content = readFileSync(fullPath);
  swaggerAssetCache[assetName] = content;
  return content;
}

function docsHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MBOS API Docs</title>
    <link rel="stylesheet" href="/docs/swagger-ui.css" />
    <style>
      body { margin: 0; background: #0f1115; color: #d4d4d4; font-family: Inter, system-ui, sans-serif; }
      .topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #262626; }
      .title { font-size: 16px; font-weight: 600; }
      .links { display: flex; gap: 12px; font-size: 13px; }
      .links a { color: #9ab5ff; text-decoration: none; }
      #swagger-ui { height: calc(100vh - 52px); overflow: auto; }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="title">MBOS API Contracts</div>
      <div class="links">
        <a href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">OpenAPI JSON</a>
        <a href="/docs/asyncapi">AsyncAPI Viewer</a>
        <a href="/api/v1/asyncapi.json" target="_blank" rel="noopener noreferrer">AsyncAPI JSON</a>
      </div>
    </div>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-ui-bundle.js"></script>
    <script src="/docs/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/api/v1/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
      });
    </script>
  </body>
</html>`;
}

function asyncApiHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MBOS AsyncAPI</title>
    <style>
      body { margin: 0; background: #0f1115; color: #d4d4d4; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #262626; font-family: Inter, system-ui, sans-serif; }
      .title { font-size: 16px; font-weight: 600; }
      .links { display: flex; gap: 12px; font-size: 13px; }
      .links a, .links button { color: #9ab5ff; background: none; border: 0; cursor: pointer; text-decoration: none; padding: 0; font: inherit; }
      pre { margin: 0; padding: 16px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="title">MBOS AsyncAPI Viewer</div>
      <div class="links">
        <a href="/docs">Swagger UI</a>
        <a href="/api/v1/asyncapi.json" target="_blank" rel="noopener noreferrer">Raw JSON</a>
        <button id="copy">Copy JSON</button>
      </div>
    </div>
    <pre id="payload">loading...</pre>
    <script>
      async function main() {
        const payloadEl = document.getElementById('payload');
        const copyBtn = document.getElementById('copy');
        const response = await fetch('/api/v1/asyncapi.json');
        const data = await response.json();
        const pretty = JSON.stringify(data, null, 2);
        payloadEl.textContent = pretty;
        copyBtn.addEventListener('click', async () => {
          await navigator.clipboard.writeText(pretty);
          copyBtn.textContent = 'Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 1000);
        });
      }
      main().catch((e) => {
        document.getElementById('payload').textContent = 'Failed to load AsyncAPI: ' + String(e);
      });
    </script>
  </body>
</html>`;
}

function serveBinary(res: http.ServerResponse, status: number, contentType: string, payload: Buffer | string): void {
  res.statusCode = status;
  res.setHeader('content-type', contentType);
  res.end(payload);
}

export function handleApiDocsRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestUrl: URL,
  json: (res: http.ServerResponse, status: number, data: unknown) => void,
): boolean {
  const pathname = requestUrl.pathname;
  if (pathname === '/api/v1/openapi.json') {
    json(res, 200, readJsonSpec('openapi'));
    return true;
  }
  if (pathname === '/api/v1/asyncapi.json') {
    json(res, 200, readJsonSpec('asyncapi'));
    return true;
  }
  if (pathname === '/docs' || pathname === '/docs/') {
    serveBinary(res, 200, 'text/html; charset=utf-8', docsHtml());
    return true;
  }
  if (pathname === '/docs/asyncapi' || pathname === '/docs/asyncapi/') {
    serveBinary(res, 200, 'text/html; charset=utf-8', asyncApiHtml());
    return true;
  }
  if (pathname === '/docs/swagger-ui.css') {
    serveBinary(res, 200, 'text/css; charset=utf-8', getSwaggerAsset('swagger-ui.css'));
    return true;
  }
  if (pathname === '/docs/swagger-ui-bundle.js') {
    serveBinary(res, 200, 'application/javascript; charset=utf-8', getSwaggerAsset('swagger-ui-bundle.js'));
    return true;
  }
  if (pathname === '/docs/swagger-ui-standalone-preset.js') {
    serveBinary(
      res,
      200,
      'application/javascript; charset=utf-8',
      getSwaggerAsset('swagger-ui-standalone-preset.js'),
    );
    return true;
  }
  return false;
}
