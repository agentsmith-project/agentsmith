import { render, screen } from '@testing-library/react';
import { PageState } from '../PageState';

test('renders loading state', () => {
  render(<PageState state="loading" />);
  expect(screen.getByTestId('page-state__loading')).toBeInTheDocument();
});
