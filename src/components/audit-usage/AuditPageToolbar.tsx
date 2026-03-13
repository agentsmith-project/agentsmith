'use client';

import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageToolbar } from '@/components/layout/PageToolbar';

interface AuditPageToolbarProps {
  isLoading: boolean;
  label: string;
  onRefresh: () => void;
}

export function AuditPageToolbar({ isLoading, label, onRefresh }: AuditPageToolbarProps) {
  return (
    <PageToolbar>
      <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
        <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        {label}
      </Button>
    </PageToolbar>
  );
}
