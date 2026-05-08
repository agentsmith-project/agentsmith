import { delimiter, isAbsolute, join, relative } from 'node:path';

const TASK_HOME_PATH_DEFAULTS = {
  ZDOTDIR: '.',
  HISTFILE: '.zsh_history',
  XDG_CONFIG_HOME: '.config',
  XDG_STATE_HOME: '.local/state',
  XDG_CACHE_HOME: '.cache',
  XDG_DATA_HOME: '.local/share',
  LESSHISTFILE: '.local/state/less/history',
  NODE_REPL_HISTORY: '.local/state/node_repl_history',
  PYTHON_HISTORY: '.local/state/python_history',
  SQLITE_HISTORY: '.local/state/sqlite_history',
  PSQL_HISTORY: '.local/state/psql_history',
  MYSQL_HISTFILE: '.local/state/mysql_history',
  IPYTHONDIR: '.ipython',
} as const;

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

function resolveTaskHomePath(homeDir: string, relativePath: string): string {
  if (relativePath === '.') return homeDir;
  return join(homeDir, relativePath);
}

function isTaskScopedPath(homeDir: string, rawValue: string | undefined): boolean {
  const value = rawValue?.trim();
  if (!value) return false;
  if (!isAbsolute(value)) return true;
  const fromHome = relative(homeDir, value);
  return fromHome === '' || (!fromHome.startsWith('..') && !isAbsolute(fromHome));
}

function normalizeTaskHomePathEnv(homeDir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalizedEnv = {
    ...env,
  };
  for (const [key, relativePath] of Object.entries(TASK_HOME_PATH_DEFAULTS)) {
    if (isTaskScopedPath(homeDir, normalizedEnv[key])) continue;
    normalizedEnv[key] = resolveTaskHomePath(homeDir, relativePath);
  }
  return normalizedEnv;
}

export function buildTaskUserInstallEnv(homeDir: string, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const localRoot = `${homeDir}/.local`;
  const cargoHome = `${homeDir}/.cargo`;
  const rustupHome = `${homeDir}/.rustup`;
  const env = normalizeTaskHomePathEnv(homeDir, {
    ...baseEnv,
    HOME: homeDir,
    TASK_HOME: homeDir,
    PYTHONUSERBASE: localRoot,
    PIP_USER: '1',
    npm_config_prefix: localRoot,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
  });
  return {
    ...env,
    PATH: prependPath(env.PATH, [
      `${localRoot}/bin`,
      `${cargoHome}/bin`,
      `${homeDir}/.local/share/npm/bin`,
    ]),
  };
}
