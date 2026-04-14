import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FileLibraryGatewayPaths {
  artifactsRoot: string;
  gatewayLogDir: string;
  gatewayStateDir: string;
}

const DEFAULT_GATEWAY_ARTIFACTS_DIR = 'artifacts';
const DEFAULT_GATEWAY_LOG_DIR = 'file-library-gateway';
const DEFAULT_GATEWAY_STATE_DIR = 'file-library-gateway-state';

export function resolveApiEntryPackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

export function resolveFileLibraryGatewayPaths(
  env: NodeJS.ProcessEnv = process.env,
): FileLibraryGatewayPaths {
  const artifactsRoot = env.FILE_LIBRARY_GATEWAY_ARTIFACTS_ROOT?.trim()
    || join(resolveApiEntryPackageRoot(), DEFAULT_GATEWAY_ARTIFACTS_DIR);

  return {
    artifactsRoot,
    gatewayLogDir: env.FILE_LIBRARY_GATEWAY_LOG_DIR?.trim()
      || join(artifactsRoot, DEFAULT_GATEWAY_LOG_DIR),
    gatewayStateDir: env.FILE_LIBRARY_GATEWAY_STATE_DIR?.trim()
      || join(artifactsRoot, DEFAULT_GATEWAY_STATE_DIR),
  };
}
