import type { Page } from '@playwright/test';

export function extractStoredAuthToken(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: { token?: string | null } };
    return typeof parsed.state?.token === 'string' && parsed.state.token.trim().length > 0
      ? parsed.state.token
      : null;
  } catch {
    return null;
  }
}

export async function readStoredAuthToken(page: Page): Promise<string | null> {
  try {
    const raw = await page.evaluate(() => {
      try {
        return window.localStorage.getItem('agentsmith-auth');
      } catch {
        return null;
      }
    });
    return extractStoredAuthToken(raw);
  } catch {
    return null;
  }
}

export async function ensureWorkspaceProjectCreatorAccess(args: {
  page: Page;
  apiBase: string;
  token: string;
  username: string;
  workspaceId?: string;
}): Promise<void> {
  const workspaceId = args.workspaceId ?? 'ws_default';
  const creatorCandidates = Array.from(
    new Set(
      [
        args.username,
        args.username.includes('@') ? null : `${args.username}@example.com`,
        args.username.includes('@') ? null : `${args.username}@corp.com`,
      ].filter((value): value is string => Boolean(value && value.trim())),
    ),
  );

  const creatorsRes = await args.page.request.get(
    `${args.apiBase}/api/v1/workspaces/${workspaceId}/project-creators`,
    { headers: { Authorization: `Bearer ${args.token}` } },
  );
  if (!creatorsRes.ok()) {
    if ([400, 403, 404, 422, 503].includes(creatorsRes.status())) {
      return;
    }
    throw new Error(`workspace_project_creators_read_failed:${creatorsRes.status()}`);
  }

  const creatorsBody = (await creatorsRes.json()) as {
    items?: Array<{ user_id?: string; email?: string; name?: string }>;
  };
  const existingCreators = Array.from(
    new Set(
      (Array.isArray(creatorsBody.items) ? creatorsBody.items : [])
        .flatMap((item) => [item.user_id, item.email, item.name])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ),
  );

  if (creatorCandidates.some((candidate) => existingCreators.includes(candidate))) {
    return;
  }

  const updateRes = await args.page.request.patch(
    `${args.apiBase}/api/v1/workspaces/${workspaceId}/project-creators`,
    {
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        project_creator_user_ids: Array.from(new Set([...existingCreators, ...creatorCandidates])),
      },
    },
  );
  if (!updateRes.ok()) {
    if ([400, 403, 404, 422, 503].includes(updateRes.status())) {
      return;
    }
    throw new Error(`workspace_project_creators_update_failed:${updateRes.status()}`);
  }
}
