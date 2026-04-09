import { delimiter } from 'node:path';

function prependPath(rawCurrentPath: string | undefined, entries: string[]): string {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    ordered.push(trimmed);
    seen.add(trimmed);
  }
  for (const entry of (rawCurrentPath ?? '').split(delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    ordered.push(trimmed);
    seen.add(trimmed);
  }
  return ordered.join(delimiter);
}

export function buildTaskUserInstallEnv(homeDir: string, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const localRoot = `${homeDir}/.local`;
  const cargoHome = `${homeDir}/.cargo`;
  const rustupHome = `${homeDir}/.rustup`;
  return {
    ...baseEnv,
    HOME: homeDir,
    PYTHONUSERBASE: localRoot,
    PIP_USER: '1',
    npm_config_prefix: localRoot,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    PATH: prependPath(baseEnv.PATH, [
      `${localRoot}/bin`,
      `${cargoHome}/bin`,
      `${homeDir}/.local/share/npm/bin`,
    ]),
  };
}
