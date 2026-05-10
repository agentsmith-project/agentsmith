import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  execFileMock,
  execFilePromisifiedMock,
  readdirMock,
  readlinkMock,
} = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFilePromisifiedMock: vi.fn(),
  readdirMock: vi.fn(),
  readlinkMock: vi.fn(),
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

import { captureResourceRecoverySnapshot } from './file-library-resource-recovery';

describe('file library resource recovery snapshot capture', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFilePromisifiedMock.mockReset();
    readdirMock.mockReset();
    readlinkMock.mockReset();

    execFilePromisifiedMock.mockResolvedValue({
      stdout: [
        'ESTAB 0 0 127.0.0.1:41000 127.0.0.1:15432 users:(("node",pid=42001,fd=31))',
        'ESTAB 0 0 127.0.0.1:41001 127.0.0.1:15432 users:(("node",pid=42001,fd=32))',
        'CLOSE-WAIT 0 0 127.0.0.1:41002 127.0.0.1:17017 users:(("node",pid=42001,fd=33))',
        'ESTAB 0 0 127.0.0.1:41003 127.0.0.1:19000 users:(("node",pid=99999,fd=34))',
      ].join('\n'),
      stderr: '',
    });
    readdirMock.mockResolvedValue(['0', '1', '2']);
    readlinkMock.mockImplementation(async (targetPath: string) => (
      targetPath.endsWith('/1') ? 'socket:[12345]' : 'pipe:[67890]'
    ));
  });

  it('captures tracked API fd/socket and tcp truth for AFSCP Files API recovery evidence', async () => {
    const snapshot = await captureResourceRecoverySnapshot(process.env, {
      apiPid: 42001,
    });

    expect(snapshot).toMatchObject({
      evidence_kind: 'afscp_files_api',
      api_processes: [
        {
          pid: 42001,
          label: 'api-entry',
          open_fd_count: 3,
          socket_fd_count: 1,
        },
      ],
      tcp_connections: [
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 15432,
          state: 'ESTABLISHED',
          count: 2,
        },
        {
          process_label: 'api-entry',
          remote_host: '127.0.0.1',
          remote_port: 17017,
          state: 'CLOSE_WAIT',
          count: 1,
        },
      ],
    });
    expect(execFilePromisifiedMock).toHaveBeenCalledWith(
      'ss',
      ['-H', '-tanp'],
      expect.objectContaining({
        encoding: 'utf8',
      }),
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

  it('captures an empty boot snapshot without scanning retired gateway or mount processes', async () => {
    const snapshot = await captureResourceRecoverySnapshot();

    expect(snapshot).toMatchObject({
      evidence_kind: 'afscp_files_api',
      api_processes: [],
      tcp_connections: [],
    });
    expect(readdirMock).not.toHaveBeenCalled();
    expect(execFilePromisifiedMock).not.toHaveBeenCalled();
  });
});
