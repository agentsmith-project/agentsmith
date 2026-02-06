import * as React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: LucideIcon;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className = '' }: BreadcrumbProps) {
  return (
    <nav className={`flex items-center gap-1 text-sm ${className}`}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <React.Fragment key={index}>
            <div className="flex items-center gap-1">
              {item.icon && (
                <item.icon className="w-4 h-4 text-tertiary" />
              )}
              {!isLast && item.href ? (
                <Link
                  href={item.href}
                  className={cn(
                    'truncate max-w-[150px]',
                    'text-secondary hover:text-primary cursor-pointer transition-colors',
                  )}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    'truncate max-w-[150px]',
                    isLast ? 'text-primary' : 'text-secondary',
                  )}
                >
                  {item.label}
                </span>
              )}
            </div>
            {!isLast && (
              <ChevronRight className="w-4 h-4 text-tertiary flex-shrink-0" />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
