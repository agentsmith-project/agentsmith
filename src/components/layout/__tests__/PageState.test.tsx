import { render, screen } from '@testing-library/react';
import { PageState } from '../PageState';

test('renders loading slot when loading', () => {
  render(<PageState state="loading" loading={<div>Loading content</div>} />);
  expect(screen.getByTestId('page-state__loading')).toBeInTheDocument();
  expect(screen.getByText('Loading content')).toBeInTheDocument();
});

test('falls back to children when loading slot missing', () => {
  render(
    <PageState state="loading">
      <div>Loading fallback</div>
    </PageState>
  );
  expect(screen.getByTestId('page-state__loading')).toBeInTheDocument();
  expect(screen.getByText('Loading fallback')).toBeInTheDocument();
});

test('renders empty slot when empty', () => {
  render(<PageState state="empty" empty={<div>Empty content</div>} />);
  expect(screen.getByTestId('page-state__empty')).toBeInTheDocument();
  expect(screen.getByText('Empty content')).toBeInTheDocument();
});

test('renders children when success', () => {
  render(
    <PageState state="success">
      <div>Success content</div>
    </PageState>
  );
  expect(screen.getByTestId('page-state__success')).toBeInTheDocument();
  expect(screen.getByText('Success content')).toBeInTheDocument();
});
