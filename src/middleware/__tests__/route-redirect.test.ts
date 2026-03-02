/**
 * Route Redirect Logic Tests - WP-03
 *
 * Tests the core redirect pattern matching and mapping logic
 * without needing Next.js middleware infrastructure.
 */

describe('Route Redirect Logic - WP-03', () => {
  // Pattern from middleware for matching legacy routes
  const LEGACY_ROUTE_PATTERN =
    /\/([^/]+)\/workspaces\/([^/]+)\/projects\/([^/]+)\/(runtime-control-plane|runtime-observability|release-ops|alerts)/;

  // Tab mapping from middleware
  const TAB_MAPPING: Record<string, string> = {
    'runtime-observability': 'monitoring',
    'release-ops': 'control',
    'alerts': 'alerts',
  };

  describe('Pattern Matching', () => {
    it('should match runtime-control-plane route', () => {
      const pathname = '/en-US/workspaces/ws1/projects/prj1/runtime-control-plane';
      const match = pathname.match(LEGACY_ROUTE_PATTERN);
      expect(match).not.toBeNull();
      expect(match?.[4]).toBe('runtime-control-plane');
    });

    it('should match runtime-observability route', () => {
      const pathname = '/en-US/workspaces/ws1/projects/prj1/runtime-observability';
      const match = pathname.match(LEGACY_ROUTE_PATTERN);
      expect(match).not.toBeNull();
      expect(match?.[4]).toBe('runtime-observability');
    });

    it('should match release-ops route', () => {
      const pathname = '/en-US/workspaces/ws1/projects/prj1/release-ops';
      const match = pathname.match(LEGACY_ROUTE_PATTERN);
      expect(match).not.toBeNull();
      expect(match?.[4]).toBe('release-ops');
    });

    it('should match alerts route', () => {
      const pathname = '/en-US/workspaces/ws1/projects/prj1/alerts';
      const match = pathname.match(LEGACY_ROUTE_PATTERN);
      expect(match).not.toBeNull();
      expect(match?.[4]).toBe('alerts');
    });

    it('should extract locale, workspace, and project from route', () => {
      const pathname = '/zh-CN/workspaces/my-workspace/projects/my-project/runtime-control-plane';
      const match = pathname.match(LEGACY_ROUTE_PATTERN);
      expect(match?.[1]).toBe('zh-CN'); // locale
      expect(match?.[2]).toBe('my-workspace'); // workspace
      expect(match?.[3]).toBe('my-project'); // project
    });

    it('should not match non-legacy routes', () => {
      const nonLegacyRoutes = [
        '/en-US/workspaces/ws1/projects/prj1/overview',
        '/en-US/workspaces/ws1/projects/prj1/chat',
        '/en-US/workspaces/ws1/projects/prj1/runtime-console',
        '/en-US/workspaces/ws1/projects/prj1/agents',
      ];

      for (const route of nonLegacyRoutes) {
        const match = route.match(LEGACY_ROUTE_PATTERN);
        expect(match).toBeNull();
      }
    });
  });

  describe('Tab Mapping', () => {
    it('should map runtime-observability to monitoring tab', () => {
      expect(TAB_MAPPING['runtime-observability']).toBe('monitoring');
    });

    it('should map release-ops to control tab', () => {
      expect(TAB_MAPPING['release-ops']).toBe('control');
    });

    it('should map alerts to alerts tab', () => {
      expect(TAB_MAPPING['alerts']).toBe('alerts');
    });

    it('should not map runtime-control-plane (no tab)', () => {
      expect(TAB_MAPPING['runtime-control-plane']).toBeUndefined();
    });
  });

  describe('Redirect URL Construction', () => {
    function buildRedirectUrl(
      locale: string,
      workspace: string,
      project: string,
      legacyRoute: string,
    ): string {
      const basePath = `/${locale}/workspaces/${workspace}/projects/${project}/runtime-console`;
      const tab = TAB_MAPPING[legacyRoute];
      return tab ? `${basePath}?tab=${tab}` : basePath;
    }

    it('should construct correct redirect for runtime-control-plane', () => {
      const url = buildRedirectUrl('en-US', 'ws1', 'prj1', 'runtime-control-plane');
      expect(url).toBe('/en-US/workspaces/ws1/projects/prj1/runtime-console');
    });

    it('should construct correct redirect for runtime-observability', () => {
      const url = buildRedirectUrl('en-US', 'ws1', 'prj1', 'runtime-observability');
      expect(url).toBe('/en-US/workspaces/ws1/projects/prj1/runtime-console?tab=monitoring');
    });

    it('should construct correct redirect for release-ops', () => {
      const url = buildRedirectUrl('en-US', 'ws1', 'prj1', 'release-ops');
      expect(url).toBe('/en-US/workspaces/ws1/projects/prj1/runtime-console?tab=control');
    });

    it('should construct correct redirect for alerts', () => {
      const url = buildRedirectUrl('en-US', 'ws1', 'prj1', 'alerts');
      expect(url).toBe('/en-US/workspaces/ws1/projects/prj1/runtime-console?tab=alerts');
    });

    it('should preserve locale in redirect', () => {
      const zhUrl = buildRedirectUrl('zh-CN', 'ws1', 'prj1', 'runtime-control-plane');
      expect(zhUrl).toContain('/zh-CN/');

      const enUrl = buildRedirectUrl('en-US', 'ws1', 'prj1', 'runtime-control-plane');
      expect(enUrl).toContain('/en-US/');
    });

    it('should preserve workspace and project IDs in redirect', () => {
      const url = buildRedirectUrl('en-US', 'my-workspace', 'my-project', 'runtime-control-plane');
      expect(url).toContain('workspaces/my-workspace');
      expect(url).toContain('projects/my-project');
    });
  });

  describe('End-to-End Redirect Logic', () => {
    function shouldRedirect(pathname: string): { redirect: boolean; to?: string } {
      const match = pathname.match(LEGACY_ROUTE_PATTERN);
      if (!match) return { redirect: false };

      const [, locale, workspace, project, legacyRoute] = match;
      const basePath = `/${locale}/workspaces/${workspace}/projects/${project}/runtime-console`;
      const tab = TAB_MAPPING[legacyRoute];
      const redirectUrl = tab ? `${basePath}?tab=${tab}` : basePath;

      return { redirect: true, to: redirectUrl };
    }

    const testCases = [
      {
        from: '/en-US/workspaces/ws1/projects/prj1/runtime-control-plane',
        to: '/en-US/workspaces/ws1/projects/prj1/runtime-console',
      },
      {
        from: '/en-US/workspaces/ws1/projects/prj1/runtime-observability',
        to: '/en-US/workspaces/ws1/projects/prj1/runtime-console?tab=monitoring',
      },
      {
        from: '/en-US/workspaces/ws1/projects/prj1/release-ops',
        to: '/en-US/workspaces/ws1/projects/prj1/runtime-console?tab=control',
      },
      {
        from: '/en-US/workspaces/ws1/projects/prj1/alerts',
        to: '/en-US/workspaces/ws1/projects/prj1/runtime-console?tab=alerts',
      },
      {
        from: '/zh-CN/workspaces/ws1/projects/prj1/runtime-control-plane',
        to: '/zh-CN/workspaces/ws1/projects/prj1/runtime-console',
      },
      {
        from: '/en-US/workspaces/ws1/projects/prj1/overview',
        to: undefined,
      },
      {
        from: '/en-US/workspaces/ws1/projects/prj1/runtime-console',
        to: undefined,
      },
    ];

    it.each(testCases)('should correctly handle $from', ({ from, to }) => {
      const result = shouldRedirect(from);
      if (to) {
        expect(result.redirect).toBe(true);
        expect(result.to).toBe(to);
      } else {
        expect(result.redirect).toBe(false);
      }
    });
  });

  describe('Query Parameter Preservation - Bug Fix', () => {
    // Simulates the middleware logic for query parameter preservation
    function buildRedirectWithQuery(
      pathname: string,
      searchParams: Record<string, string>,
    ): string {
      const match = pathname.match(LEGACY_ROUTE_PATTERN);
      if (!match) return pathname;

      const [, locale, workspace, project, legacyRoute] = match;
      const basePath = `/${locale}/workspaces/${workspace}/projects/${project}/runtime-console`;
      const tab = TAB_MAPPING[legacyRoute];

      // Build URL preserving all original query parameters
      const queryParams = new URLSearchParams();
      Object.entries(searchParams).forEach(([key, value]) => {
        queryParams.set(key, value);
      });

      // Set tab parameter if mapped
      if (tab) {
        queryParams.set('tab', tab);
      }

      const queryString = queryParams.toString();
      return queryString ? `${basePath}?${queryString}` : basePath;
    }

    it('should preserve governance query parameters', () => {
      const pathname = '/en-US/workspaces/ws1/projects/prj1/release-ops';
      const searchParams = {
        'gov_from': 'organization_overview',
        'gov_kind': 'workspace',
        'gov_workspace_id': 'ws_default',
        'gov_project_id': 'proj_001',
        'gov_reason': 'cost',
      };

      const result = buildRedirectWithQuery(pathname, searchParams);
      expect(result).toContain('/runtime-console?');
      expect(result).toContain('tab=control');
      expect(result).toContain('gov_from=organization_overview');
      expect(result).toContain('gov_kind=workspace');
      expect(result).toContain('gov_reason=cost');
    });

    it('should preserve filter query parameters', () => {
      const pathname = '/en-US/workspaces/ws1/projects/prj1/runtime-observability';
      const searchParams = {
        'result': 'error',
        'time_range': '24h',
        'provider': 'secondaryok',
      };

      const result = buildRedirectWithQuery(pathname, searchParams);
      expect(result).toContain('/runtime-console?');
      expect(result).toContain('tab=monitoring');
      expect(result).toContain('result=error');
      expect(result).toContain('time_range=24h');
      expect(result).toContain('provider=secondaryok');
    });

    it('should preserve mixed query parameters', () => {
      const pathname = '/en-US/workspaces/ws1/projects/prj1/alerts';
      const searchParams = {
        'gov_context': 'incident_drilldown',
        'severity': 'critical',
        'status': 'open',
      };

      const result = buildRedirectWithQuery(pathname, searchParams);
      expect(result).toContain('/runtime-console?');
      expect(result).toContain('tab=alerts');
      expect(result).toContain('gov_context=incident_drilldown');
      expect(result).toContain('severity=critical');
      expect(result).toContain('status=open');
    });

    it('should handle route without tab mapping but with query params', () => {
      const pathname = '/en-US/workspaces/ws1/projects/prj1/runtime-control-plane';
      const searchParams = {
        'panel': 'advanced',
        'view': 'json',
      };

      const result = buildRedirectWithQuery(pathname, searchParams);
      expect(result).toContain('/runtime-console?');
      expect(result).toContain('panel=advanced');
      expect(result).toContain('view=json');
      // No tab parameter for runtime-control-plane
      expect(result).not.toContain('tab=');
    });

    it('should preserve empty query parameters', () => {
      const pathname = '/en-US/workspaces/ws1/projects/prj1/release-ops';
      const searchParams = {};

      const result = buildRedirectWithQuery(pathname, searchParams);
      expect(result).toBe('/en-US/workspaces/ws1/projects/prj1/runtime-console?tab=control');
    });
  });
});
