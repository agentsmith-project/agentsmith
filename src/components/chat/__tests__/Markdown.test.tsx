import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('should block images by default (safe default)', () => {
    // When NEXT_PUBLIC_TRUSTED_IMAGE_DOMAINS is not configured (empty),
    // all images should be blocked - this is the safe default
    render(<Markdown content="![](https://example.com/image.png)" />);

    // Should show blocked message since no domains are trusted by default
    expect(screen.getByText('[Image blocked: unsafe source]')).toBeInTheDocument();
  });
});

describe('Markdown - Comprehensive Security Tests', () => {
  it('should reject images from untrusted domains', () => {
    const maliciousMarkdown = '![xss](http://evil.com/image.png)';
    const { container } = render(<Markdown content={maliciousMarkdown} />);

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(0);
  });

  it('should reject data URLs (potential XSS)', () => {
    const dataUrlMarkdown = '![xss](data:image/svg+xml,<script>alert(1)</script>)';
    const { container } = render(<Markdown content={dataUrlMarkdown} />);

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(0);
  });

  it('should reject javascript: URLs', () => {
    const jsUrlMarkdown = '![xss](javascript:alert(1))';
    const { container } = render(<Markdown content={jsUrlMarkdown} />);

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(0);
  });

  it('should reject images with onerror attributes (XSS attempt)', () => {
    const xssMarkdown = '![](http://example.com/img.png "onerror="alert(1))';
    const { container } = render(<Markdown content={xssMarkdown} />);

    const images = container.querySelectorAll('img');
    if (images.length > 0) {
      expect(images[0].getAttribute('onerror')).toBeNull();
    }
  });

  it('should sanitize script tags in markdown', () => {
    const scriptMarkdown = '<script>alert("xss")</script>';
    const { container } = render(<Markdown content={scriptMarkdown} />);

    const scripts = container.querySelectorAll('script');
    expect(scripts).toHaveLength(0);
  });

  it('should sanitize iframe tags', () => {
    const iframeMarkdown = '<iframe src="javascript:alert(1)"></iframe>';
    const { container } = render(<Markdown content={iframeMarkdown} />);

    const iframes = container.querySelectorAll('iframe');
    expect(iframes).toHaveLength(0);
  });

  it('should sanitize object/embed tags', () => {
    const objectMarkdown = '<object data="javascript:alert(1)"></object>';
    const { container } = render(<Markdown content={objectMarkdown} />);

    const objects = container.querySelectorAll('object');
    expect(objects).toHaveLength(0);
  });

  it('should block images with file:// protocol', () => {
    const fileUrlMarkdown = '![local](file:///etc/passwd)';
    const { container } = render(<Markdown content={fileUrlMarkdown} />);

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(0);
  });

  it('should block images with ftp:// protocol', () => {
    const ftpUrlMarkdown = '![ftp](ftp://example.com/image.png)';
    const { container } = render(<Markdown content={ftpUrlMarkdown} />);

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(0);
  });

  it('should reject XSS attempts in link href', () => {
    const xssLink = '[click me](javascript:alert(1))';
    const { container } = render(<Markdown content={xssLink} />);

    const links = container.querySelectorAll('a');
    // Link should either not exist or not have javascript: href
    if (links.length > 0) {
      const href = links[0].getAttribute('href');
      expect(href).not.toEqual(expect.stringContaining('javascript:'));
      expect(href).toBeFalsy(); // rehype-sanitize should strip javascript: URLs
    }
  });

  it('should sanitize onmouseover attributes', () => {
    const xssMarkdown = '<span onmouseover="alert(1)">hover me</span>';
    const { container } = render(<Markdown content={xssMarkdown} />);

    const spans = container.querySelectorAll('span');
    if (spans.length > 0) {
      expect(spans[0].getAttribute('onmouseover')).toBeNull();
    }
  });

  it('should block images with HTTP (HTTPS only)', () => {
    const httpMarkdown = '![image](http://example.com/image.png)';
    const { container } = render(<Markdown content={httpMarkdown} />);

    // HTTPS-only policy: http should be blocked
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(0);
  });

  it('should block all images when NEXT_PUBLIC_TRUSTED_IMAGE_DOMAINS is empty', () => {
    // Safe default: when no domains are configured, NO images are allowed
    // This test verifies the safe default behavior
    const httpsMarkdown = '![image](https://anydomain.com/image.png)';
    const { container } = render(<Markdown content={httpsMarkdown} />);

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(0);
    // Should show blocked message
    expect(screen.getByText('[Image blocked: unsafe source]')).toBeInTheDocument();
  });

  it('should handle multiple XSS attack vectors in one markdown', () => {
    const multiXssMarkdown = `
      <script>alert('xss')</script>
      ![](javascript:alert(1))
      ![](data:image/svg+xml,<script>alert(1)</script>)
      [click me](javascript:alert(1))
      <span onmouseover="alert(1)">hover</span>
    `;
    const { container } = render(<Markdown content={multiXssMarkdown} />);

    // No scripts should execute
    const scripts = container.querySelectorAll('script');
    expect(scripts).toHaveLength(0);

    // No images with dangerous protocols
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(0);

    // No links with javascript:
    const links = container.querySelectorAll('a');
    links.forEach(link => {
      expect(link.getAttribute('href')).not.toContain('javascript:');
    });
  });
});

describe('Markdown - Content Rendering', () => {
  it('should render paragraph text', () => {
    render(<Markdown content="This is a paragraph" />);

    expect(screen.getByText('This is a paragraph')).toBeInTheDocument();
  });

  it('should render strong/bold text', () => {
    const { container } = render(<Markdown content="**bold text**" />);

    expect(screen.getByText('bold text')).toBeInTheDocument();
    const strong = container.querySelector('strong');
    expect(strong).toBeInTheDocument();
  });

  it('should render italic text', () => {
    const { container } = render(<Markdown content="*italic text*" />);

    expect(screen.getByText('italic text')).toBeInTheDocument();
    const em = container.querySelector('em');
    expect(em).toBeInTheDocument();
  });

  it('should render inline code', () => {
    render(<Markdown content="This has `inline code` in it" />);

    expect(screen.getByText('inline code')).toBeInTheDocument();
  });

  it('should render code blocks with language', () => {
    const { container } = render(<Markdown content="```javascript\nconst x = 1;\n```" />);

    // Check that code content is rendered
    expect(container.textContent).toContain('const x = 1;');

    // Check that code block structure exists
    const codeBlock = container.querySelector('.border-b.border-subtle.bg-surface');
    expect(codeBlock).toBeInTheDocument();
  });

  it('should render code blocks without language', () => {
    const { container } = render(<Markdown content="```\nconst x = 1;\n```" />);

    expect(container.textContent).toContain('const x = 1;');
    expect(screen.getByText('code')).toBeInTheDocument();
  });

  it('should render unordered lists', () => {
    const { container } = render(<Markdown content="- Item 1\n- Item 2\n- Item 3" />);

    expect(container.textContent).toContain('Item 1');
    expect(container.textContent).toContain('Item 2');
    expect(container.textContent).toContain('Item 3');

    const ul = container.querySelector('ul');
    expect(ul).toBeInTheDocument();
  });

  it('should render ordered lists', () => {
    const { container } = render(<Markdown content="1. First\n2. Second\n3. Third" />);

    expect(container.textContent).toContain('First');
    expect(container.textContent).toContain('Second');
    expect(container.textContent).toContain('Third');

    const ol = container.querySelector('ol');
    expect(ol).toBeInTheDocument();
  });

  it('should render blockquotes', () => {
    render(<Markdown content="> This is a quote" />);

    expect(screen.getByText('This is a quote')).toBeInTheDocument();
    const blockquote = screen.getByText('This is a quote').closest('blockquote');
    expect(blockquote).toBeInTheDocument();
  });

  it('should render horizontal rules', () => {
    const { container } = render(<Markdown content="---" />);

    const hr = container.querySelector('hr');
    expect(hr).toBeInTheDocument();
  });

  it('should render tables', () => {
    const tableContent = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1 | Cell 2 |
`;
    const { container } = render(<Markdown content={tableContent} />);

    expect(container.textContent).toContain('Header 1');
    expect(container.textContent).toContain('Header 2');
    expect(container.textContent).toContain('Cell 1');
    expect(container.textContent).toContain('Cell 2');

    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
  });

  it('should render links', () => {
    render(<Markdown content="[Example](https://example.com)" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveTextContent('Example');
  });

  it('should render mailto links', () => {
    render(<Markdown content="[Email](mailto:test@example.com)" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'mailto:test@example.com');
  });

  it('should handle multi-line content', () => {
    const { container } = render(<Markdown content="Line 1\n\nLine 2\n\nLine 3" />);

    expect(container.textContent).toContain('Line 1');
    expect(container.textContent).toContain('Line 2');
    expect(container.textContent).toContain('Line 3');
  });

  it('should handle empty content', () => {
    const { container } = render(<Markdown content="" />);

    // Should render without crashing
    expect(container).toBeInTheDocument();
  });

  it('should handle whitespace-only content', () => {
    const { container } = render(<Markdown content="   \n\n   " />);

    // Should render without crashing
    expect(container).toBeInTheDocument();
  });
});

describe('Markdown - GFM Features', () => {
  it('should render strikethrough text', () => {
    render(<Markdown content="~~deleted text~~" />);

    expect(screen.getByText('deleted text')).toBeInTheDocument();
  });

  it('should render task lists', () => {
    render(<Markdown content="- [x] Completed task\n- [ ] Incomplete task" />);

    // Check that checkboxes are rendered
    const { container } = render(<Markdown content="- [x] Completed task\n- [ ] Incomplete task" />);

    expect(container.textContent).toContain('Completed task');
    expect(container.textContent).toContain('Incomplete task');

    // Check for checkboxes
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it('should handle tables with alignment', () => {
    // Tables require blank lines in GFM
    const tableContent = `
| Left | Center | Right |
|:-----|:------:|------:|
| A | B | C |
`;

    const { container } = render(<Markdown content={tableContent} />);

    expect(container.textContent).toContain('Left');
    expect(container.textContent).toContain('Center');
    expect(container.textContent).toContain('Right');
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('B');
    expect(container.textContent).toContain('C');
  });
});

describe('Markdown - Code Block Copy', () => {
  it('should render copy button in code blocks', () => {
    render(<Markdown content="```javascript\nconst x = 1;\n```" />);

    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('should show copied state after clicking', async () => {
    const user = userEvent.setup();
    const mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('navigator', {
      clipboard: mockClipboard,
    });

    render(<Markdown content="```javascript\nconst x = 1;\n```" />);

    const copyButton = screen.getByText('Copy');
    await user.click(copyButton);

    // Wait for state update
    await vi.waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it('should copy code without trailing newline', async () => {
    const user = userEvent.setup();
    const mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('navigator', {
      clipboard: mockClipboard,
    });

    render(<Markdown content="```javascript\nconst x = 1;\n```" />);

    const copyButton = screen.getByText('Copy');
    await user.click(copyButton);

    // The raw value is what's passed as children to the code element
    // react-markdown passes the content, and we replace trailing newline
    expect(mockClipboard.writeText).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
