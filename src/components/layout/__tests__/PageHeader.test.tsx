import { render, screen } from '@testing-library/react';
import { PageHeader } from '../PageHeader';

test('renders title, subtitle, and actions', () => {
  render(<PageHeader title="Overview" subtitle="Summary" actions={<button>Action</button>} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
  expect(screen.getByText('Summary')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
});
