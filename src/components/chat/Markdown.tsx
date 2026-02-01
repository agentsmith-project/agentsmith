import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

function CodeBlock({
  inline,
  className,
  children,
}: {
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = React.useState(false);
  const raw = String(children ?? '');

  if (inline) {
    return (
      <code className="font-mono text-[13px] text-primary bg-hover px-1 py-0.5 rounded-sm border border-subtle">
        {children}
      </code>
    );
  }

  const language = (className || '').replace('language-', '').trim();

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

const sanitizeSchema = {
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
    // GFM task list
    'input',
    // Images (keep safe via sanitize)
    'img',
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a || []), ['target'], ['rel']],
    img: [...(defaultSchema.attributes?.img || []), ['src'], ['alt'], ['title'], ['width'], ['height'], ['loading']],
    input: [
      ...(defaultSchema.attributes?.input || []),
      ['type'],
      ['checked'],
      ['disabled'],
    ],
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    span: [...(defaultSchema.attributes?.span || []), ['className']],
    th: [...(defaultSchema.attributes?.th || []), ['align']],
    td: [...(defaultSchema.attributes?.td || []), ['align']],
  },
};

export function Markdown({ content }: { content: string }) {
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
            rel="noreferrer"
          >
            {children}
          </a>
        ),
        img: ({ alt, ...props }) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            {...props}
            alt={alt || ''}
            className="max-w-full h-auto rounded-md border border-subtle"
            loading="lazy"
          />
        ),
        p: ({ children }) => <p className="text-sm leading-6 text-primary">{children}</p>,
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
        code: ({ children, className, ...props }) => (
          <CodeBlock
            inline={Boolean((props as unknown as { inline?: boolean }).inline)}
            className={className}
          >
            {children}
          </CodeBlock>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
