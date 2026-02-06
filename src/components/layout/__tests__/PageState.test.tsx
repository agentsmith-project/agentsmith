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

test('does not fall back to children when loading slot is null', () => {
  render(
    <PageState state="loading" loading={null}>
      <div>Loading null fallback</div>
    </PageState>
  );
  expect(screen.getByTestId('page-state__loading')).toBeInTheDocument();
  expect(screen.queryByText('Loading null fallback')).not.toBeInTheDocument();
});

test('renders empty slot when empty', () => {
  render(<PageState state="empty" empty={<div>Empty content</div>} />);
  expect(screen.getByTestId('page-state__empty')).toBeInTheDocument();
  expect(screen.getByText('Empty content')).toBeInTheDocument();
});

test('falls back to children when empty slot missing', () => {
  render(
    <PageState state="empty">
      <div>Empty fallback</div>
    </PageState>
  );
  expect(screen.getByTestId('page-state__empty')).toBeInTheDocument();
  expect(screen.getByText('Empty fallback')).toBeInTheDocument();
});

test('does not fall back to children when empty slot is null', () => {
  render(
    <PageState state="empty" empty={null}>
      <div>Empty null fallback</div>
    </PageState>
  );
  expect(screen.getByTestId('page-state__empty')).toBeInTheDocument();
  expect(screen.queryByText('Empty null fallback')).not.toBeInTheDocument();
});

test('falls back to children when error slot missing', () => {
  render(
    <PageState state="error">
      <div>Error fallback</div>
    </PageState>
  );
  expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
  expect(screen.getByText('Error fallback')).toBeInTheDocument();
});

test('does not fall back to children when error slot is null', () => {
  render(
    <PageState state="error" error={null}>
      <div>Error null fallback</div>
    </PageState>
  );
  expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
  expect(screen.queryByText('Error null fallback')).not.toBeInTheDocument();
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

test('uses compact centered spacing for non-success states', () => {
  render(<PageState state="loading" loading={<div>Loading content</div>} />);
  const root = screen.getByTestId('page-state__loading');
  expect(root).toHaveClass('px-4');
  expect(root).toHaveClass('py-6');
});
