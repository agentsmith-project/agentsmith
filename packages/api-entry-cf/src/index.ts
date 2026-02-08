import type { ListProjectsResponse } from '@mbos/contracts';

export interface Env {}

export default {
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
