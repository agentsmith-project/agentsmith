'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Copy, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import { useErrorHandler } from '@/lib/hooks/use-error-handler';

interface JSONViewerProps {
  data: Record<string, unknown>;
  className?: string;
}

function JSONNode({
  keyName,
  value,
  level = 0,
}: {
  keyName: string;
  value: unknown;
  level?: number;
}) {
  const [isExpanded, setIsExpanded] = React.useState(level < 2); // Auto-expand first 2 levels

  if (value === null) {
    return (
      <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 16}px` }}>
        <span className="text-tertiary">{keyName}:</span>
        <span className="text-error">null</span>
      </div>
    );
  }

  if (typeof value === 'string') {
    return (
      <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 16}px` }}>
        <span className="text-tertiary">{keyName}:</span>
        <span className="text-foreground">"{value}"</span>
      </div>
    );
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 16}px` }}>
        <span className="text-tertiary">{keyName}:</span>
        <span className="text-accent">{String(value)}</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div style={{ paddingLeft: `${level * 16}px` }}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-tertiary hover:text-foreground transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span>{keyName}:</span>
          <span className="text-tertiary">[{value.length}]</span>
        </button>
        {isExpanded && (
          <div className="ml-4 mt-1">
            {value.map((item, index) => (
              <JSONNode key={index} keyName={`[${index}]`} value={item} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div style={{ paddingLeft: `${level * 16}px` }}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-tertiary hover:text-foreground transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span>{keyName}:</span>
          <span className="text-tertiary">{'{'}</span>
          <span className="text-tertiary">{entries.length} keys</span>
          <span className="text-tertiary">{'}'}</span>
        </button>
        {isExpanded && (
          <div className="ml-4 mt-1">
            {entries.map(([k, v]) => (
              <JSONNode key={k} keyName={k} value={v} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

export function JSONViewer({ data, className }: JSONViewerProps) {
  const t = useTranslations('common');
  const [_isAllExpanded, _setIsAllExpanded] = React.useState(false);
  const { handleError } = useErrorHandler();

  const handleCopy = () => {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      navigator.clipboard.writeText(jsonString);
      toast.success(t('copied'));
    } catch (error) {
      handleError(error, { logContext: 'JSONViewer.copy', fallbackMessage: 'Failed to copy JSON' });
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Metadata</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-2" />
            Copy JSON
          </Button>
        </div>
      </div>
      <div className="bg-surface-high rounded-md p-4 border border-border overflow-auto max-h-[400px] font-mono text-sm">
        {Object.entries(data).map(([key, value]) => (
          <JSONNode key={key} keyName={key} value={value} level={0} />
        ))}
      </div>
    </div>
  );
}
