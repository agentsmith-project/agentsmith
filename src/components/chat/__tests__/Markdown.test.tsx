import { render, screen } from '@testing-library/react';
import { Markdown } from '../Markdown';

describe('Markdown component security', () => {
  it('should render safe markdown', () => {
    render(<Markdown content="**Hello** world" />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('should block javascript: URLs in images', () => {
    render(<Markdown content="![](javascript:alert('xss'))" />);

    // Image should be blocked with placeholder
    expect(screen.getByText('[Image blocked: unsafe source]')).toBeInTheDocument();
  });

  it('should block data: URLs in images', () => {
    render(<Markdown content="![](data:image/svg+xml,<script>alert('xss')</script>)" />);

    expect(screen.getByText('[Image blocked: unsafe source]')).toBeInTheDocument();
  });

  it('should block vbscript: URLs', () => {
    render(<Markdown content="![](vbscript:msgbox('xss'))" />);

    expect(screen.getByText('[Image blocked: unsafe source]')).toBeInTheDocument();
  });

  it('should allow images from trusted domains', () => {
    render(<Markdown content="![](https://example.com/image.png)" />);

    // Trusted domain images should render
    // Note: rehype-sanitize may strip some images based on its default schema
    // Our custom component provides additional validation
    const { container } = render(<Markdown content="![](https://example.com/image.png)" />);
    const img = container.querySelector('img[src="https://example.com/image.png"]');
    expect(img).toBeInTheDocument();
  });

  it('should block images from untrusted domains', () => {
    render(<Markdown content="![](https://untrusted.com/image.png)" />);

    expect(screen.getByText('[Image blocked: unsafe source]')).toBeInTheDocument();
  });

  it('should handle untrusted domains gracefully', () => {
    render(<Markdown content="![](https://untrusted.com/image.png)" />);

    // Should show blocked message for untrusted domains
    expect(screen.getByText('[Image blocked: unsafe source]')).toBeInTheDocument();
  });

  it('should escape HTML in markdown', () => {
    const { container } = render(<Markdown content="<script>alert('xss')</script>" />);

    // Script tag should not execute - rehype-sanitize handles this
    const scripts = container.querySelectorAll('script');
    expect(scripts).toHaveLength(0);
  });

  it('should add noopener to external links', () => {
    render(<Markdown content="[Link](https://example.com)" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('should render code blocks safely', () => {
    render(<Markdown content="```javascript\nconsole.log('test')\n```" />);

    const code = screen.getByText(/console\.log/);
    expect(code).toBeInTheDocument();
  });
});
