import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const STABLE_SUMMARY = { total_bytes: 1024, docdb_collections: 2, vectordb_indexes: 3 };
const STABLE_END_USERS = [
  {
    id: 'eu_1',
    storage_bytes: 512,
    docdb_collections: 1,
    vectordb_indexes: 1,
  },
];

vi.mock('@/lib/hooks/use-userdata', () => ({
  useUserdataSummary: () => ({
    data: STABLE_SUMMARY,
  }),
  useUserdataEndUsers: () => ({
    data: STABLE_END_USERS,
  }),
}));

import { UserDataPage } from '../UserDataPage';

describe('UserDataPage', () => {
  it('renders summary and end users', () => {
    render(<UserDataPage workspaceId="ws_1" projectId="prj_1" />);
    expect(screen.getByText('summary_title')).toBeInTheDocument();
    expect(screen.getByText('eu_1')).toBeInTheDocument();
  });
});
