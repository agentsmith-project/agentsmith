import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docTaskFixtures, docArtifactFixtures } from '../doc-fixtures/notebook';

export const notebookHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/notebook/tasks', () =>
    HttpResponse.json({ items: DOC_FIXTURES_ENABLED ? docTaskFixtures : p0.tasks })),
  http.get('/api/v1/workspaces/:ws/projects/:prj/notebook/tasks/:id/artifacts', ({ params }) =>
    HttpResponse.json({
      items: (DOC_FIXTURES_ENABLED ? docArtifactFixtures : p0.artifacts).filter(
        (item) => item.task_id === params.id,
      ),
    })),
];
