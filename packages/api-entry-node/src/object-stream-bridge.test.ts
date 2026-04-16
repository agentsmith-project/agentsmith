import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHttpOperationEnvelope,
  parseMultipartUploadAndExecute,
} from './object-stream-bridge.js';

class FakeBusboy extends Writable {
  private readonly emitter = new EventEmitter();

  _write(
    _chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback();
  }

  override on(event: 'field', listener: (name: string, value: string) => void): this;
  override on(
    event: 'file',
    listener: (
      name: string,
      file: PassThrough & { on(event: 'limit', listener: () => void): PassThrough; resume(): PassThrough },
      info: { filename?: string; mimeType?: string },
    ) => void,
  ): this;
  override on(event: 'error', listener: (error: Error) => void): this;
  override on(event: 'finish', listener: () => void): this;
  override on(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  override emit(event: 'field', name: string, value: string): boolean;
  override emit(
    event: 'file',
    name: string,
    file: PassThrough & { on(event: 'limit', listener: () => void): PassThrough; resume(): PassThrough },
    info: { filename?: string; mimeType?: string },
  ): boolean;
  override emit(event: 'error', error: Error): boolean;
  override emit(event: 'finish'): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return this.emitter.emit(event, ...args);
  }
}

describe('object-stream-bridge multipart lifecycle envelope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with the original business error and aborts the multipart envelope when execute throws before finish', async () => {
    const req = new PassThrough() as PassThrough & http.IncomingMessage;
    req.headers = {
      'content-type': 'multipart/form-data; boundary=----agentsmith',
    };
    const unpipeSpy = vi.spyOn(req, 'unpipe');

    const busboy = new FakeBusboy();
    const file = new PassThrough() as PassThrough & {
      on(event: 'limit', listener: () => void): PassThrough;
      resume(): PassThrough;
      destroy(error?: Error): PassThrough;
    };
    const resumeSpy = vi.spyOn(file, 'resume');
    const destroySpy = vi.spyOn(file, 'destroy');

    const routePromise = parseMultipartUploadAndExecute(
      req,
      () => {
        throw new Error('file_library_destination_exists');
      },
      () => busboy,
    );

    let emittedError: unknown = null;
    try {
      busboy.emit('file', 'file', file, {
        filename: 'hello.txt',
        mimeType: 'text/plain',
      });
    } catch (error) {
      emittedError = error;
    }

    expect(emittedError).toBeNull();
    await expect(routePromise).rejects.toThrow('file_library_destination_exists');

    expect(unpipeSpy).toHaveBeenCalledWith(busboy);
    expect(resumeSpy).toHaveBeenCalled();
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(destroySpy.mock.calls[0]?.[0]).toMatchObject({
      name: 'AbortError',
    });
  });

  it('aborts, unpipes, and drains the multipart file when execute fails before consuming the upload stream', async () => {
    const req = new PassThrough() as PassThrough & http.IncomingMessage;
    req.headers = {
      'content-type': 'multipart/form-data; boundary=----agentsmith',
    };
    const unpipeSpy = vi.spyOn(req, 'unpipe');

    const busboy = new FakeBusboy();
    const file = new PassThrough() as PassThrough & {
      on(event: 'limit', listener: () => void): PassThrough;
      resume(): PassThrough;
    };
    const resumeSpy = vi.spyOn(file, 'resume');

    const routePromise = parseMultipartUploadAndExecute(
      req,
      async ({ signal }) => {
        expect(signal.aborted).toBe(false);
        throw new Error('file_library_destination_exists');
      },
      () => busboy,
    );

    busboy.emit('file', 'file', file, {
      filename: 'hello.txt',
      mimeType: 'text/plain',
    });

    await expect(routePromise).rejects.toThrow('file_library_destination_exists');

    expect(unpipeSpy).toHaveBeenCalledWith(busboy);
    expect(resumeSpy).toHaveBeenCalled();
  });

  it('rejects when a multipart upload contains a second file part instead of invoking execute twice', async () => {
    const req = new PassThrough() as PassThrough & http.IncomingMessage;
    req.headers = {
      'content-type': 'multipart/form-data; boundary=----agentsmith',
    };

    const busboy = new FakeBusboy();
    const firstFile = new PassThrough() as PassThrough & {
      on(event: 'limit', listener: () => void): PassThrough;
      resume(): PassThrough;
    };
    const secondFile = new PassThrough() as PassThrough & {
      on(event: 'limit', listener: () => void): PassThrough;
      resume(): PassThrough;
    };

    const executeCalls: Array<{ fileName: string; signal: AbortSignal }> = [];

    const routePromise = parseMultipartUploadAndExecute(
      req,
      async ({ fileName, signal }) => {
        executeCalls.push({ fileName, signal });
        return {
          fileName,
          aborted: signal.aborted,
        };
      },
      () => busboy,
    );

    busboy.emit('file', 'file', firstFile, {
      filename: 'first.txt',
      mimeType: 'text/plain',
    });
    busboy.emit('file', 'file', secondFile, {
      filename: 'second.txt',
      mimeType: 'text/plain',
    });
    busboy.emit('finish');

    expect(executeCalls.map(({ fileName }) => fileName)).toEqual(['first.txt']);
    await expect(routePromise).rejects.toBeInstanceOf(Error);
  });

  it('rejects duplicate multipart file part because the second file replaces the active upload envelope', async () => {
    const req = new PassThrough() as PassThrough & http.IncomingMessage;
    req.headers = {
      'content-type': 'multipart/form-data; boundary=----agentsmith',
    };

    const busboy = new FakeBusboy();
    const firstFile = new PassThrough() as PassThrough & {
      on(event: 'limit', listener: () => void): PassThrough;
      resume(): PassThrough;
    };
    const secondFile = new PassThrough() as PassThrough & {
      on(event: 'limit', listener: () => void): PassThrough;
      resume(): PassThrough;
    };
    const seenFileNames: string[] = [];

    const routePromise = parseMultipartUploadAndExecute(
      req,
      async ({ fileName }) => {
        seenFileNames.push(fileName);
        return { fileName };
      },
      () => busboy,
    );

    busboy.emit('file', 'file', firstFile, {
      filename: 'first.txt',
      mimeType: 'text/plain',
    });
    busboy.emit('file', 'file', secondFile, {
      filename: 'second.txt',
      mimeType: 'text/plain',
    });
    busboy.emit('finish');

    const outcome = await routePromise.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({
        status: 'rejected' as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    );

    expect(seenFileNames).toEqual(['first.txt']);
    expect(outcome).toEqual({
      status: 'rejected',
      message: 'file_library_multiple_files_not_supported',
    });
  });

  it('aborts the multipart envelope when the outer http operation closes after busboy finish but before execute settles', async () => {
    const req = new PassThrough() as PassThrough & http.IncomingMessage;
    req.headers = {
      'content-type': 'multipart/form-data; boundary=----agentsmith',
    };

    const routeAbortController = new AbortController();
    const busboy = new FakeBusboy();
    const file = new PassThrough() as PassThrough & {
      on(event: 'limit', listener: () => void): PassThrough;
      resume(): PassThrough;
    };

    let executeSignal: AbortSignal | null = null;
    const routePromise = parseMultipartUploadAndExecute(
      req,
      async ({ signal }) => {
        executeSignal = signal;
        return await new Promise<never>(() => {});
      },
      () => busboy,
      {
        signal: routeAbortController.signal,
      } as never,
    );

    busboy.emit('file', 'file', file, {
      filename: 'hello.txt',
      mimeType: 'text/plain',
    });
    busboy.emit('finish');

    routeAbortController.abort(new Error('client_response_closed'));

    await expect(routePromise).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(executeSignal?.aborted).toBe(true);
  });
});

describe('object-stream-bridge http operation envelope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not treat a completed request body as client_request_aborted once the operation enters response phase', () => {
    const req = new EventEmitter() as EventEmitter & http.IncomingMessage & {
      aborted: boolean;
      destroyed: boolean;
      complete: boolean;
    };
    req.aborted = false;
    req.destroyed = false;
    req.complete = false;

    const res = new EventEmitter() as EventEmitter & http.ServerResponse & {
      writableEnded: boolean;
      destroyed: boolean;
      writableDestroyed?: boolean;
    };
    res.writableEnded = false;
    res.destroyed = false;
    res.writableDestroyed = false;

    const operation = createHttpOperationEnvelope({ req, res });
    operation.markRequestBodyConsumed();

    req.complete = true;
    req.destroyed = true;
    req.emit('aborted');

    expect(operation.signal.aborted).toBe(false);

    operation.cleanup();
  });
});
