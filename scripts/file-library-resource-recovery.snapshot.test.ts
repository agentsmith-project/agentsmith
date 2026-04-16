import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  execFileMock,
  execFilePromisifiedMock,
  readdirMock,
  readlinkMock,
  resolvePreflightOptionsMock,
  loadGatewayStatesMock,
  loadProcessTableMock,
  matchGatewayStateForProcessMock,
  findMountedTaskDirectoriesMock,
  extractGatewayProcessIdentityMock,
} = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFilePromisifiedMock: vi.fn(),
  readdirMock: vi.fn(),
  readlinkMock: vi.fn(),
  resolvePreflightOptionsMock: vi.fn(),
  loadGatewayStatesMock: vi.fn(),
  loadProcessTableMock: vi.fn(),
  matchGatewayStateForProcessMock: vi.fn(),
  findMountedTaskDirectoriesMock: vi.fn(),
  extractGatewayProcessIdentityMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const execFilePatched = Object.assign(execFileMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: execFilePromisifiedMock,
  });
  return {
    ...actual,
    default: {
      ...actual,
      execFile: execFilePatched,
    },
    execFile: execFilePatched,
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual,
      readdir: readdirMock,
      readlink: readlinkMock,
    },
    readdir: readdirMock,
    readlink: readlinkMock,
  };
});

vi.mock('./juicefs-orphan-preflight', () => ({
  resolvePreflightOptions: resolvePreflightOptionsMock,
  loadGatewayStates: loadGatewayStatesMock,
  loadProcessTable: loadProcessTableMock,
  matchGatewayStateForProcess: matchGatewayStateForProcessMock,
  findMountedTaskDirectories: findMountedTaskDirectoriesMock,
  extractGatewayProcessIdentity: extractGatewayProcessIdentityMock,
}));

import { captureResourceRecoverySnapshot } from './file-library-resource-recovery';

describe('file library resource recovery snapshot capture', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFilePromisifiedMock.mockReset();
    readdirMock.mockReset();
    readlinkMock.mockReset();
    resolvePreflightOptionsMock.mockReset();
    loadGatewayStatesMock.mockReset();
    loadProcessTableMock.mockReset();
    matchGatewayStateForProcessMock.mockReset();
    findMountedTaskDirectoriesMock.mockReset();
    extractGatewayProcessIdentityMock.mockReset();

    execFilePromisifiedMock.mockResolvedValue({
      stdout: '',
      stderr: '',
    });
    resolvePreflightOptionsMock.mockReturnValue({
      gatewayStateDir: '/gateway-state',
      taskMountRoot: '/task-mounts',
    });
    loadGatewayStatesMock.mockResolvedValue([]);
    loadProcessTableMock.mockResolvedValue([]);
    matchGatewayStateForProcessMock.mockReturnValue(null);
    findMountedTaskDirectoriesMock.mockResolvedValue([]);
    extractGatewayProcessIdentityMock.mockReturnValue({
      label: null,
      libraryId: null,
      ownerScope: null,
    });
    readlinkMock.mockResolvedValue('socket:[12345]');
  });

  it('ignores non-authoritative helper processes that disappear before /proc fd truth can be sampled', async () => {
    loadProcessTableMock.mockResolvedValue([
      {
        pid: 2002,
        ppid: 1,
        ageSeconds: 2,
        command: 'mc rb --force fladmin/jfs-lib-helper',
        cwd: null,
      },
    ]);
    readdirMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/proc/2002/fd') {
        const error = new Error('ENOENT while listing helper fd truth');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
      return [];
    });

    const snapshot = await captureResourceRecoverySnapshot();

    expect(snapshot.helper_labels).toEqual([]);
    expect(snapshot.helper_processes).toEqual([]);
    expect(snapshot.tcp_connections).toEqual([]);
  });

  it('fails closed when an authority-backed managed gateway disappears before /proc fd truth can be sampled', async () => {
    loadGatewayStatesMock.mockResolvedValue([
      {
        libraryId: 'existing-library',
        ownerScope: 'api-v1:instance-a:boot-current',
        stateFilePath: '/gateway-state/existing-library.json',
      },
    ]);
    loadProcessTableMock.mockResolvedValue([
      {
        pid: 3001,
        ppid: 1,
        ageSeconds: 2,
        command: 'juicefs gateway redis://cache /tmp/library --bucket minio://mbos-dev/existing-library',
        cwd: null,
      },
    ]);
    matchGatewayStateForProcessMock.mockReturnValue({
      libraryId: 'existing-library',
      ownerScope: 'api-v1:instance-a:boot-current',
      stateFilePath: '/gateway-state/existing-library.json',
    });
    readdirMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/proc/3001/fd') {
        const error = new Error('ENOENT while listing managed gateway fd truth');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
      return [];
    });

    await expect(captureResourceRecoverySnapshot()).rejects.toThrow(
      'tracked state:existing-library pid 3001 disappeared before fd truth could be captured',
    );
  });

  it('fails closed when the tracked api process disappears before /proc fd truth can be sampled', async () => {
    readdirMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/proc/42001/fd') {
        const error = new Error('ENOENT while listing api fd truth');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
      return [];
    });

    await expect(
      captureResourceRecoverySnapshot(process.env, {
        apiPid: 42001,
      }),
    ).rejects.toThrow(
      'tracked api-entry pid 42001 disappeared before fd truth could be captured',
    );
  });
});
