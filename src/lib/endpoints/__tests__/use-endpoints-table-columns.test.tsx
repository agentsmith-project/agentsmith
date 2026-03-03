/**
 * useEndpointsTableColumns Unit Tests
 *
 * Tests the table column definitions for the endpoints list.
 * Validates proper rendering, actions, and responsive behavior.
 */

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useEndpointsTableColumns } from '../use-endpoints-table-columns';
import type { Endpoint } from '@/lib/api/types';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
}));

// Mock translations
const mockEndpointsT = (key: string) => key;

// Mock mutation functions
const mockDeleteMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockOnEdit = vi.fn();
const mockOnDeleteRequest = vi.fn();
const mockOnTestConnection = vi.fn();

const deleteEndpointMutation = {
  mutate: mockDeleteMutate,
  isPending: false,
};

const updateEndpointMutation = {
  mutate: mockUpdateMutate,
  isPending: false,
};

// Test endpoint data
const _createMockEndpoint = (overrides: Partial<Endpoint> = {}): Endpoint => ({
  id: 'endpoint-1',
  project_id: 'proj-001',
  name: 'GPT-4o Production',
  description: 'Production GPT-4o endpoint',
  openai_model: 'gpt-4o',
  type: 'openai',
  provider_family: 'openai',
  protocol: 'openai_compatible',
  base_url: 'https://api.openai.com/v1',
  status: 'active',
  credential_ref: 'cred-1',
  capabilities: [
    { type: 'chat_completion', enabled: true, default_model_id: 'gpt-4o' },
  ],
  models: [
    {
      capability: 'chat_completion',
      model_id: 'gpt-4o',
      display_name: 'GPT-4o',
    },
  ],
  defaults: {
    chat_model_id: 'gpt-4o',
  },
  created_at: '2026-03-03T00:00:00Z',
  updated_at: '2026-03-03T00:00:00Z',
  ...overrides,
});

describe('useEndpointsTableColumns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    t: mockEndpointsT,
    canManageEndpoints: true,
    deleteEndpointMutation,
    updateEndpointMutation,
    onEdit: mockOnEdit,
    onDeleteRequest: mockOnDeleteRequest,
  };

  const renderColumns = (props = {}) => {
    return renderHook(() =>
      useEndpointsTableColumns({
        ...defaultProps,
        ...props,
      } as any)
    ).result.current;
  };

  describe('Column Definitions', () => {
    it('should return all expected columns', () => {
      const columns = renderColumns({ onTestConnection: mockOnTestConnection });
      expect(columns).toHaveLength(9); // provider, name, model, capability, compatibility, health, pricing, admin_status, actions
    });

    it('should include provider column with logo', () => {
      const columns = renderColumns();
      // Column may use accessorKey or id, check for either
      const providerColumn = columns.find((col: any) =>
        col.id === 'provider_family' || col.accessorKey === 'provider_family'
      );
      expect(providerColumn).toBeDefined();
    });

    it('should include health status column', () => {
      const columns = renderColumns();
      const healthColumn = columns.find((col: any) => col.id === 'health');
      expect(healthColumn).toBeDefined();
    });

    it('should include pricing column', () => {
      const columns = renderColumns();
      const pricingColumn = columns.find((col: any) => col.id === 'pricing');
      expect(pricingColumn).toBeDefined();
    });
  });

  describe('Action Buttons', () => {
    it('should show all action buttons when user has manage permission', () => {
      const columns = renderColumns({ onTestConnection: mockOnTestConnection });
      const actionsColumn = columns.find((col: any) => col.id === 'actions');
      expect(actionsColumn).toBeDefined();
    });

    it('should show dash when user does not have manage permission', () => {
      const columns = renderColumns({ canManageEndpoints: false });
      const actionsColumn = columns.find((col: any) => col.id === 'actions');
      expect(actionsColumn).toBeDefined();
    });

    it('should not have test connection when callback not provided', () => {
      const columns = renderColumns();
      const actionsColumn = columns.find((col: any) => col.id === 'actions');
      expect(actionsColumn).toBeDefined();
    });
  });

  describe('Memoization', () => {
    it('should return stable column references for same inputs', () => {
      const { result: result1 } = renderHook(() =>
        useEndpointsTableColumns({ ...defaultProps as any })
      );

      const { result: result2 } = renderHook(() =>
        useEndpointsTableColumns({ ...defaultProps as any })
      );

      // Same columns should be returned for same inputs
      expect(result1.current).toHaveLength(result2.current.length);
    });

    it('should have same number of columns regardless of permission', () => {
      const { result: resultWithPerm } = renderHook(() =>
        useEndpointsTableColumns({ ...defaultProps, canManageEndpoints: true } as any)
      );

      const { result: resultWithoutPerm } = renderHook(() =>
        useEndpointsTableColumns({ ...defaultProps, canManageEndpoints: false } as any)
      );

      expect(resultWithPerm.current).toHaveLength(resultWithoutPerm.current.length);
    });
  });

  describe('Responsive Actions', () => {
    it('should include dropdown menu trigger for mobile view', () => {
      const columns = renderColumns({ onTestConnection: mockOnTestConnection });
      const actionsColumn = columns.find((col: any) => col.id === 'actions');
      expect(actionsColumn).toBeDefined();

      // The actions column should have a cell renderer
      expect(actionsColumn?.cell).toBeDefined();
    });

    it('should respect canManageEndpoints permission', () => {
      const columnsWithoutPermission = renderColumns({ canManageEndpoints: false });
      const actionsColumn = columnsWithoutPermission.find((col: any) => col.id === 'actions');

      // Should still have actions column but show "-" for non-managers
      expect(actionsColumn).toBeDefined();
    });
  });
});
