import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="space-y-3 break-words text-sm leading-7 text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          h1: ({ children }) => <h1 className="mb-3 text-xl font-semibold tracking-tight">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 text-lg font-semibold tracking-tight">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 text-base font-semibold tracking-tight">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-border pl-4 text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground/80"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => (
            className?.includes('language-') || String(children).includes('\n') ? (
              <code className="block overflow-x-auto font-mono text-[0.92em] leading-6">{children}</code>
            ) : (
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.92em]">{children}</code>
            )
          ),
          pre: ({ children }) => (
            <pre className="app-scrollbar mb-3 overflow-x-auto rounded-2xl border border-border bg-muted/70 px-4 py-3 last:mb-0">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-4 border-border" />,
          table: ({ children }) => (
            <div className="app-scrollbar mb-3 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-border px-3 py-2 font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
