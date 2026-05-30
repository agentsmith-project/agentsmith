import { describe, expect, it } from 'vitest';
import { buildTaskUserInstallEnv } from './user-install-env.js';

describe('user-install-env', () => {
  it('rewrites leaked shell history and xdg state paths into the task home', () => {
    const env = buildTaskUserInstallEnv('/home/task_1', {
      PATH: '/usr/bin:/bin',
      WORKSPACE_PATH: '/home/task_1/workspace',
      HISTFILE: '/home/percy/.zsh_history',
      ZDOTDIR: '/home/percy/.config/zsh',
      XDG_CONFIG_HOME: '/home/percy/.config',
      XDG_STATE_HOME: '/home/percy/.local/state',
      XDG_CACHE_HOME: '/home/percy/.cache',
      XDG_DATA_HOME: '/home/percy/.local/share',
      LESSHISTFILE: '/home/percy/.lesshst',
      NODE_REPL_HISTORY: '/home/percy/.node_repl_history',
      PYTHON_HISTORY: '/home/percy/.python_history',
      SQLITE_HISTORY: '/home/percy/.sqlite_history',
      PSQL_HISTORY: '/home/percy/.psql_history',
      MYSQL_HISTFILE: '/home/percy/.mysql_history',
      IPYTHONDIR: '/home/percy/.ipython',
    });

    expect(env).toMatchObject({
      HOME: '/home/task_1',
      TASK_HOME: '/home/task_1',
      WORKSPACE_PATH: '/home/task_1/workspace',
      HISTFILE: '/home/task_1/.zsh_history',
      ZDOTDIR: '/home/task_1',
      XDG_CONFIG_HOME: '/home/task_1/.config',
      XDG_STATE_HOME: '/home/task_1/.local/state',
      XDG_CACHE_HOME: '/home/task_1/.cache',
      XDG_DATA_HOME: '/home/task_1/.local/share',
      LESSHISTFILE: '/home/task_1/.local/state/less/history',
      NODE_REPL_HISTORY: '/home/task_1/.local/state/node_repl_history',
      PYTHON_HISTORY: '/home/task_1/.local/state/python_history',
      SQLITE_HISTORY: '/home/task_1/.local/state/sqlite_history',
      PSQL_HISTORY: '/home/task_1/.local/state/psql_history',
      MYSQL_HISTFILE: '/home/task_1/.local/state/mysql_history',
      IPYTHONDIR: '/home/task_1/.ipython',
      PYTHONUSERBASE: '/home/task_1/.local',
      npm_config_prefix: '/home/task_1/.local',
      CARGO_HOME: '/home/task_1/.cargo',
      RUSTUP_HOME: '/home/task_1/.rustup',
    });
    expect(env.PATH?.split(':').slice(0, 3)).toEqual([
      '/home/task_1/.local/bin',
      '/home/task_1/.cargo/bin',
      '/home/task_1/.local/share/npm/bin',
    ]);
  });

  it('preserves relative and already task-scoped overrides', () => {
    const env = buildTaskUserInstallEnv('/home/task_1', {
      PATH: '/usr/bin:/bin',
      HISTFILE: '.history/zsh',
      ZDOTDIR: '/home/task_1/.config/zsh',
      XDG_STATE_HOME: '/home/task_1/.local/custom-state',
    });

    expect(env.HISTFILE).toBe('.history/zsh');
    expect(env.ZDOTDIR).toBe('/home/task_1/.config/zsh');
    expect(env.XDG_STATE_HOME).toBe('/home/task_1/.local/custom-state');
  });

  it('scrubs runner control credentials while preserving request-scoped runtime env', () => {
    const env = buildTaskUserInstallEnv('/home/task_1', {
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/zsh',
      MBOS_AGENT_WS_URL: 'ws://runner-control.example/ws',
      MBOS_AGENT_KEY: 'ask_control_secret',
      AGENT_WS_URL: 'ws://runner-control.example/alias-ws',
      AGENT_KEY: 'ask_alias_control_secret',
      MBOS_AGENT_API_BASE: 'http://localhost:20000/api/v1',
      MBOS_AGENT_EXECUTION_TICKET: 'ticket_123',
      MBOS_AGENT_WORKSPACE_ID: 'ws_1',
      MBOS_AGENT_PROJECT_ID: 'proj_1',
      MBOS_AGENT_TASK_ID: 'task_1',
      MBOS_AGENT_RUN_ID: 'run_1',
      MBOS_AGENT_PROJECTED_DEPENDENCIES: '{"dependencies":{}}',
    });

    expect(env.MBOS_AGENT_WS_URL).toBeUndefined();
    expect(env.MBOS_AGENT_KEY).toBeUndefined();
    expect(env.AGENT_WS_URL).toBeUndefined();
    expect(env.AGENT_KEY).toBeUndefined();
    expect(env).toMatchObject({
      SHELL: '/bin/zsh',
      MBOS_AGENT_API_BASE: 'http://localhost:20000/api/v1',
      MBOS_AGENT_EXECUTION_TICKET: 'ticket_123',
      MBOS_AGENT_WORKSPACE_ID: 'ws_1',
      MBOS_AGENT_PROJECT_ID: 'proj_1',
      MBOS_AGENT_TASK_ID: 'task_1',
      MBOS_AGENT_RUN_ID: 'run_1',
      MBOS_AGENT_PROJECTED_DEPENDENCIES: '{"dependencies":{}}',
    });
  });
});
