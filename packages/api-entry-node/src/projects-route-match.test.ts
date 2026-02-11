import { describe, expect, it } from 'vitest';
import { matchProjectsRoute } from './projects-route-match.js';

describe('matchProjectsRoute', () => {
  it('matches workspace and project collection routes', () => {
    expect(matchProjectsRoute('/api/v1/workspaces')).toEqual({ kind: 'workspacesCollection' });
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects')).toEqual({
      kind: 'collection',
      workspaceId: 'ws_default',
    });
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1')).toEqual({
      kind: 'item',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
  });

  it('matches chat stream and stop routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/s_1/messages/stream'),
    ).toEqual({
      kind: 'chatMessagesStream',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 's_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/s_1/messages/streams/st_1/stop'),
    ).toEqual({
      kind: 'chatMessagesStreamStop',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 's_1',
      streamId: 'st_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/s_1/messages/streams/st_1'),
    ).toEqual({
      kind: 'chatMessagesStreamAttach',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 's_1',
      streamId: 'st_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/s_1/stop'),
    ).toEqual({
      kind: 'chatSessionStop',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 's_1',
    });
  });

  it('matches endpoint proxy and import routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/import-openai-compatible'),
    ).toEqual({
      kind: 'endpointImportOpenAICompatible',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/proxy/chat/completions'),
    ).toEqual({
      kind: 'endpointProxy',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_1',
      proxyPath: 'chat/completions',
    });
  });

  it('matches source library object browser routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects'),
    ).toEqual({
      kind: 'sourceLibraryObjects',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/folders'),
    ).toEqual({
      kind: 'sourceLibraryFolders',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/upload'),
    ).toEqual({
      kind: 'sourceLibraryObjectsUpload',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/download'),
    ).toEqual({
      kind: 'sourceLibraryObjectsDownload',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/delete'),
    ).toEqual({
      kind: 'sourceLibraryObjectsDelete',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/move'),
    ).toEqual({
      kind: 'sourceLibraryObjectsMove',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/meta'),
    ).toEqual({
      kind: 'sourceLibraryObjectsMeta',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
  });

  it('returns null for unknown route', () => {
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/unknown')).toBeNull();
  });
});
