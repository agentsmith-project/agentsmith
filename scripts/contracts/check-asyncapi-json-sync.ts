import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSpecJsonFromYaml } from '../openapi/generate-json';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const ASYNCAPI_YAML_PATH = 'docs/contracts/specs/asyncapi.yaml';
const ASYNCAPI_JSON_PATH = 'docs/contracts/specs/asyncapi.json';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8');
}

function main(): void {
  const expectedJson = renderSpecJsonFromYaml(readRepoFile(ASYNCAPI_YAML_PATH));
  const currentJson = readRepoFile(ASYNCAPI_JSON_PATH);

  if (currentJson !== expectedJson) {
    process.stderr.write(
      [
        '[contracts] AsyncAPI JSON is out of sync with AsyncAPI YAML.',
        `Source: ${ASYNCAPI_YAML_PATH}`,
        `Generated artifact: ${ASYNCAPI_JSON_PATH}`,
        'Run: npm run asyncapi:sync-json',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  process.stdout.write('[contracts] AsyncAPI JSON is in sync with AsyncAPI YAML.\n');
}

main();
