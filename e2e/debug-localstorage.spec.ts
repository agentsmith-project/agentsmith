import { test, expect } from '@playwright/test';

test('debug localStorage content', async ({ page }) => {
  const mockAuthState = {
    state: {
      user: {
        id: 'user_123',
        email: 'test@example.com',
        name: 'Test User',
        locale: 'en-US',
      },
      token: 'mock_jwt_token_123',
      isAuthenticated: true,
      currentWorkspace: {
        id: 'ws_default',
        name: 'Default Workspace',
        role: 'owner',
      },
      currentProject: {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'AI Assistant Project',
        visibility: 'public',
        role: 'owner',
        permissions: ['project:*'],
        status: 'active',
      },
      workspaces: [
        {
          id: 'ws_default',
          name: 'Default Workspace',
          role: 'owner',
        },
      ],
      projects: [
        {
          id: 'proj_001',
          workspace_id: 'ws_default',
          name: 'AI Assistant Project',
          visibility: 'public',
          role: 'owner',
          permissions: ['project:*'],
          status: 'active',
        },
      ],
    },
    version: 0,
  };

  // Listen to console events
  page.on('console', msg => {
    if (msg.type() === 'log') {
      console.log('PAGE CONSOLE:', msg.text());
    }
  });

  // Set localStorage via context initScript
  await page.context().addInitScript((authState) => {
    console.log('Setting localStorage with:', JSON.stringify(authState).substring(0, 200));
    localStorage.setItem('mbos-auth', JSON.stringify(authState));
    const stored = localStorage.getItem('mbos-auth');
    console.log('Stored data, length:', stored?.length);
  }, mockAuthState);

  // Navigate to the projects page
  await page.goto('http://localhost:3000/en-US/workspaces/ws_default/projects');
  await page.waitForTimeout(3000);

  // Check what's in localStorage after page load
  const localStorageContent = await page.evaluate(() => {
    const item = localStorage.getItem('mbos-auth');
    if (item) {
      const parsed = JSON.parse(item);
      return {
        hasState: !!parsed.state,
        hasProjects: !!parsed.state?.projects,
        projectsCount: parsed.state?.projects?.length || 0,
        projects: parsed.state?.projects,
      };
    }
    return { error: 'No item found' };
  });

  console.log('localStorage content:', JSON.stringify(localStorageContent, null, 2));

  // Take a screenshot
  await page.screenshot({ path: 'test-results/debug-screenshot.png' });
});
