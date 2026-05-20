import { describe, expect, it } from 'vitest';
import {
  isReusableTaskWorkspaceFileLibrary,
  selectReusableTaskWorkspaceFileLibraryId,
} from './file-library-reuse-selector.mjs';

describe('file library reuse selector', () => {
  it('does not reuse ready libraries while an active task binding is still present', () => {
    expect(selectReusableTaskWorkspaceFileLibraryId({
      items: [
        {
          id: 'fl_active',
          status: 'ready',
          task_home_binding_status: 'bound',
          bound_task_visible: true,
          bound_task_status: 'active',
        },
      ],
    })).toBeNull();
  });

  it('reuses only ready libraries with explicit backend reusable affordance for the same actor', () => {
    expect(selectReusableTaskWorkspaceFileLibraryId({
      items: [
        { id: 'fl_creating', status: 'creating', task_home_binding_status: 'unbound', bound_task_visible: false },
        {
          id: 'fl_reusable',
          status: 'ready',
          task_home_binding_status: 'unbound',
          bound_task_visible: false,
          task_workspace_reuse_affordance: {
            allowed: true,
            same_actor: true,
            runtime_writable_affordance: 'task_internal_home',
          },
        },
      ],
    })).toBe('fl_reusable');
    expect(selectReusableTaskWorkspaceFileLibraryId({
      id: 'fl_reusable_detail',
      status: 'ready',
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
      task_workspace_reuse_affordance: {
        allowed: true,
        same_actor: true,
        runtime_writable_affordance: 'task_internal_home',
      },
    })).toBe('fl_reusable_detail');
  });

  it('fails closed when the list response, binding fields, or reusable affordance are missing or contradictory', () => {
    expect(selectReusableTaskWorkspaceFileLibraryId(null)).toBeNull();
    expect(selectReusableTaskWorkspaceFileLibraryId({})).toBeNull();
    expect(selectReusableTaskWorkspaceFileLibraryId({
      items: 'not-an-array',
      id: 'fl_malformed_list',
      status: 'ready',
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
    })).toBeNull();
    expect(selectReusableTaskWorkspaceFileLibraryId({
      items: [
        { id: 'fl_no_binding_fields', status: 'ready' },
        { id: 'fl_no_visibility', status: 'ready', task_home_binding_status: 'unbound' },
        {
          id: 'fl_contradictory',
          status: 'ready',
          task_home_binding_status: 'unbound',
          bound_task_visible: false,
          bound_task_status: 'active',
        },
        {
          id: 'fl_no_affordance',
          status: 'ready',
          task_home_binding_status: 'unbound',
          bound_task_visible: false,
        },
        {
          id: 'fl_other_actor',
          status: 'ready',
          task_home_binding_status: 'unbound',
          bound_task_visible: false,
          task_workspace_reuse_affordance: {
            allowed: true,
            same_actor: false,
            runtime_writable_affordance: 'task_internal_home',
          },
        },
      ],
    })).toBeNull();
  });

  it('models the exact reusable item predicate for static guards', () => {
    expect(isReusableTaskWorkspaceFileLibrary({
      id: 'fl_reusable',
      status: 'ready',
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
      task_workspace_reuse_affordance: {
        allowed: true,
        same_actor: true,
        runtime_writable_affordance: 'task_internal_home',
      },
    })).toBe(true);
    expect(isReusableTaskWorkspaceFileLibrary({
      id: 'fl_redacted_bound',
      status: 'ready',
      task_home_binding_status: 'bound',
      bound_task_visible: false,
      task_workspace_reuse_affordance: {
        allowed: true,
        same_actor: true,
        runtime_writable_affordance: 'task_internal_home',
      },
    })).toBe(false);
  });
});
