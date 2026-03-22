import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

/**
 * SECURITY: Image Domain Whitelist
 *
 * Only allow images from trusted domains to prevent XSS attacks.
 * Malicious users could embed tracking pixels or exploit CORS issues.
 *
 * Configuration via environment variable:
 * NEXT_PUBLIC_TRUSTED_IMAGE_DOMAINS=cdn.example.com,images.trusted.com
 *
 * IMPORTANT: Safe default - NO images are allowed unless explicitly configured.
 * This prevents the placeholder domain vulnerability where example.com or similar
 * placeholder domains could inadvertently allow arbitrary images.
 */
const TRUSTED_IMAGE_DOMAINS = getPublicRuntimeConfig().trustedImageDomains;

/**
 * Build a strict sanitization schema that prevents XSS attacks
 */
const buildStrictSchema = () => {
  const schema = {
    ...defaultSchema,
    tagNames: [
      ...(defaultSchema.tagNames || []),
      // GFM tables
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      // GFM task list (checkboxes)
      'input',
      // Code blocks
      'pre',
      // Images (restricted - validated separately in component)
      'img',
    ],
    attributes: {
      ...defaultSchema.attributes,
      // Links: allow target and rel for security
      a: [...(defaultSchema.attributes?.a || []), ['target'], ['rel']],
      // Images: ONLY allow safe attributes (actual src validation happens in component)
      img: [
        ['src'],      // Source URL (validated separately)
        ['alt'],      // Alt text
        ['title'],    // Title text
        ['width'],    // Dimensions (safe)
        ['height'],   // Dimensions (safe)
        ['loading'],  // Loading="lazy" (safe)
      ],
      // Input: only for GFM task lists (checkboxes)
      input: [
        ['type'],     // Only "checkbox" allowed
        ['checked'],  // Boolean for checked state
        ['disabled'], // Boolean for disabled state
      ],
      // Code blocks: className for syntax highlighting
      code: [...(defaultSchema.attributes?.code || []), ['className']],
      span: [...(defaultSchema.attributes?.span || []), ['className']],
      // Table alignment
      th: [...(defaultSchema.attributes?.th || []), ['align']],
      td: [...(defaultSchema.attributes?.td || []), ['align']],
    },
    // PROTOCOLS: Only allow safe protocols
    protocols: {
      ...defaultSchema.protocols,
      href: [
        'http',
        'https',
        'mailto',
      ],
      // NO 'data', NO 'javascript', NO 'vbscript' for src
      // We override src to ONLY allow http/https
      src: [
        'http',
        'https',
      ],
    },
  };

  return schema;
};

const sanitizeSchema = buildStrictSchema();

/**
 * Validate image URL against trusted domains and safe protocols
 * Returns true if URL is safe, false otherwise
 *
 * SECURITY NOTES:
 * - Only HTTPS protocol is allowed (no http:, data:, javascript:, etc.)
 * - Domain must be in TRUSTED_IMAGE_DOMAINS whitelist
 * - Supports both exact match and subdomain match (e.g., 'example.com' matches 'cdn.example.com')
 * - Safe default: NO domains trusted unless explicitly configured via env var
 */
function isValidImageUrl(url: string): boolean {
  // Safe default: no images allowed if no trusted domains configured
  if (TRUSTED_IMAGE_DOMAINS.length === 0) {
    return false;
  }

  if (!url) return false;

  try {
    const parsed = new URL(url);

    // Only allow https: protocol (http: is deprecated for security)
    if (parsed.protocol !== 'https:') {
      return false;
    }

    // Check if domain is trusted
    const domain = parsed.hostname.toLowerCase();
    return TRUSTED_IMAGE_DOMAINS.some(trusted =>
      domain === trusted || domain.endsWith(`.${trusted}`),
    );
  } catch {
    // Invalid URL
    return false;
  }
}

function CodeBlock({
  language,
  raw,
}: {
  language?: string;
  raw: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw.replace(/\n$/, ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="border border-subtle rounded-md overflow-hidden bg-surface-high">
      <div className="h-9 px-3 flex items-center justify-between border-b border-subtle bg-surface">
        <span className="text-xs text-tertiary font-mono">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs text-primary hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm px-2 py-1"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[13px] leading-5">
        <code className="font-mono text-primary whitespace-pre">{raw}</code>
      </pre>
    </div>
  );
}

export function Markdown({ content }: { content: string }) {
  const renderParagraph = (children: React.ReactNode) => {
    const hasBlockChild = React.Children.toArray(children).some((child) => {
      if (!React.isValidElement(child)) {
        return false;
      }
      if (typeof child.type !== 'string') {
        return true;
      }
      return child.type === 'div' || child.type === 'pre' || child.type === 'table';
    });

    if (hasBlockChild) {
      return <div className="text-sm leading-6 text-primary">{children}</div>;
    }

    return <p className="text-sm leading-6 text-primary">{children}</p>;
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
      components={{
        a: ({ children, ...props }) => (
          <a
            {...props}
            className="text-accent hover:underline underline-offset-4"
            target="_blank"
            rel="noreferrer noopener"  // Added noopener for security
          >
            {children}
          </a>
        ),
        img: ({ alt, src, ...props }) => {
          // Validate image URL before rendering
          if (!src || typeof src !== 'string' || !isValidImageUrl(src)) {
            // Return null or placeholder for unsafe images
            return (
              <span className="text-tertiary text-xs">
                [Image blocked: unsafe source]
              </span>
            );
          }

          return (
            <img
              src={src}
              alt={alt || ''}
              className="max-w-full h-auto rounded-md border border-subtle"
              loading="lazy"
              {...props}
            />
          );
        },
        p: ({ children }) => renderParagraph(children),
        strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
        em: ({ children }) => <em className="text-primary italic">{children}</em>,
        ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 text-sm text-primary">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 text-sm text-primary">{children}</ol>,
        li: ({ children }) => <li className="text-sm text-primary">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-subtle pl-3 text-sm text-tertiary">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-subtle my-3" />,
        table: ({ children }) => (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-subtle rounded-md overflow-hidden">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-surface">{children}</thead>,
        tbody: ({ children }) => <tbody className="bg-transparent">{children}</tbody>,
        tr: ({ children }) => <tr className="border-b border-subtle last:border-b-0">{children}</tr>,
        th: ({ children }) => (
          <th className="px-3 py-2 text-xs uppercase tracking-wide text-tertiary text-left">
            {children}
          </th>
        ),
        td: ({ children }) => <td className="px-3 py-2 text-sm text-primary">{children}</td>,
        pre: ({ children }) => {
          const child = React.Children.toArray(children)[0];
          if (!React.isValidElement(child)) {
            return <pre className="p-3 overflow-x-auto text-[13px] leading-5">{children}</pre>;
          }

          const childProps = child.props as { className?: string; children?: React.ReactNode };
          const language = (childProps.className || '').replace('language-', '').trim();
          const raw = String(childProps.children ?? '');
          return <CodeBlock language={language} raw={raw} />;
        },
        code: ({ children, className, ...props }) => {
          const raw = String(children ?? '');
          const inline = (props as unknown as { inline?: boolean }).inline;
          const languageFromClass = (className || '').replace('language-', '').trim();
          const withRealNewline = raw.includes('\n');
          const withEscapedNewline = raw.includes('\\n');
          const languagePrefixed = raw.match(/^([a-z0-9#+.-]+)(?:\\n|\n)([\s\S]*)$/i);
          const shouldRenderBlock =
            inline === false || !!languageFromClass || withRealNewline || withEscapedNewline;

          if (shouldRenderBlock) {
            const normalizedRaw = languagePrefixed
              ? languagePrefixed[2].replace(/\\n/g, '\n')
              : raw.replace(/\\n/g, '\n');
            const language = languageFromClass || languagePrefixed?.[1] || '';
            return <CodeBlock language={language} raw={normalizedRaw} />;
          }

          return (
            <code className="font-mono text-[13px] text-primary bg-hover px-1 py-0.5 rounded-sm border border-subtle">
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
