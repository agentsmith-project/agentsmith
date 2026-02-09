import type { ListProjectsResponse } from '@mbos/contracts';

const workerHandler = {
  async fetch(): Promise<Response> {
    const body: ListProjectsResponse = { items: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    });
  },
};

export default workerHandler;
