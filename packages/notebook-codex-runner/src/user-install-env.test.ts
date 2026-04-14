import { describe, expect, it } from 'vitest';
import { buildTaskUserInstallEnv } from './user-install-env.js';

describe('user-install-env', () => {
  it('rewrites leaked shell history and xdg state paths into the task home', () => {
    const env = buildTaskUserInstallEnv('/workspace/task_1', {
      PATH: '/usr/bin:/bin',
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
      HOME: '/workspace/task_1',
      HISTFILE: '/workspace/task_1/.zsh_history',
      ZDOTDIR: '/workspace/task_1',
      XDG_CONFIG_HOME: '/workspace/task_1/.config',
      XDG_STATE_HOME: '/workspace/task_1/.local/state',
      XDG_CACHE_HOME: '/workspace/task_1/.cache',
      XDG_DATA_HOME: '/workspace/task_1/.local/share',
      LESSHISTFILE: '/workspace/task_1/.local/state/less/history',
      NODE_REPL_HISTORY: '/workspace/task_1/.local/state/node_repl_history',
      PYTHON_HISTORY: '/workspace/task_1/.local/state/python_history',
      SQLITE_HISTORY: '/workspace/task_1/.local/state/sqlite_history',
      PSQL_HISTORY: '/workspace/task_1/.local/state/psql_history',
      MYSQL_HISTFILE: '/workspace/task_1/.local/state/mysql_history',
      IPYTHONDIR: '/workspace/task_1/.ipython',
    });
  });

  it('preserves relative and already task-scoped overrides', () => {
    const env = buildTaskUserInstallEnv('/workspace/task_1', {
      PATH: '/usr/bin:/bin',
      HISTFILE: '.history/zsh',
      ZDOTDIR: '/workspace/task_1/.config/zsh',
      XDG_STATE_HOME: '/workspace/task_1/.local/custom-state',
    });

    expect(env.HISTFILE).toBe('.history/zsh');
    expect(env.ZDOTDIR).toBe('/workspace/task_1/.config/zsh');
    expect(env.XDG_STATE_HOME).toBe('/workspace/task_1/.local/custom-state');
  });
});
