'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Plus, Minus } from 'lucide-react';
import { isHighRiskPermission } from '@/lib/constants/permissions';
export interface ChangesPreviewProps {
  added: string[];
  removed: string[];
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function ChangesPreview({
  added,
  removed,
  onConfirm: _onConfirm,
  onCancel: _onCancel,
}: ChangesPreviewProps) {
  const t = useTranslations('members.permissions');
  const highRiskAdded = added.filter((p) => isHighRiskPermission(p));

  if (added.length === 0 && removed.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{t('changes_preview')}</h4>
        <div className="flex items-center gap-2 text-xs text-tertiary">
          <span className="text-success">+{added.length}</span>
          {removed.length > 0 && <span className="text-error">-{removed.length}</span>}
        </div>
      </div>

      {highRiskAdded.length > 0 && (
        <div className="rounded-md bg-error/10 border border-error/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-error">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">{t('high_risk_warning')}</span>
          </div>
          <p className="text-xs text-tertiary">
            {t('high_risk_description')}
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs text-foreground">
            {highRiskAdded.map((permission) => (
              <li key={permission}>
                <code className="font-mono">{permission}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {added.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-success">
            <Plus className="h-4 w-4" />
            <span className="font-medium">{t('added')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {added.map((permission) => (
              <Badge
                key={permission}
                variant={isHighRiskPermission(permission) ? 'destructive' : 'default'}
                className="text-xs font-mono"
              >
                {permission}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {removed.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-error">
            <Minus className="h-4 w-4" />
            <span className="font-medium">{t('removed')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {removed.map((permission) => (
              <Badge key={permission} variant="outline" className="text-xs font-mono line-through">
                {permission}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
