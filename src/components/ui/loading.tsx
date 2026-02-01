/**
 * Loading Components
 *
 * Consistent loading states across the application.
 */

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <Loader2 className={`animate-spin ${sizeClasses[size]} text-tertiary`} />
      {text && <p className="text-sm text-tertiary">{text}</p>}
    </div>
  );
}

interface PageLoadingProps {
  title?: string;
  description?: string;
}

export function PageLoading({ title: _title = 'Loading...', description }: PageLoadingProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <LoadingSpinner size="lg" />
        {description && <p className="text-tertiary mt-4">{description}</p>}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8">
      {Icon && <Icon className="w-16 h-16 text-tertiary mb-4" />}
      <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
      {description && <p className="text-tertiary mb-6 max-w-md">{description}</p>}
      {action && (
        <Button variant="action" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
