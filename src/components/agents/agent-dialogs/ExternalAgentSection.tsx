'use client';

import { Input } from '@/components/ui/input';

interface ExternalAgentSectionProps {
  createPending: boolean;
  externalAcceptedMimeTypes: string;
  externalMaxFileCount: string;
  externalMaxTotalBytes: string;
  externalMultimodal: boolean;
  t: (key: string) => string;
  onExternalAcceptedMimeTypesChange: (value: string) => void;
  onExternalMaxFileCountChange: (value: string) => void;
  onExternalMaxTotalBytesChange: (value: string) => void;
  onExternalMultimodalChange: (value: boolean) => void;
}

export function ExternalAgentSection({
  createPending,
  externalAcceptedMimeTypes,
  externalMaxFileCount,
  externalMaxTotalBytes,
  externalMultimodal,
  t,
  onExternalAcceptedMimeTypesChange,
  onExternalMaxFileCountChange,
  onExternalMaxTotalBytesChange,
  onExternalMultimodalChange,
}: ExternalAgentSectionProps) {
  return (
    <div className="space-y-4 p-4 rounded-sm border border-subtle bg-surface-low">
      <h4 className="text-sm font-medium text-foreground">{t('create_dialog.capabilities_title')}</h4>
      <label className="flex items-center gap-2 text-sm text-primary">
        <input
          type="checkbox"
          checked={externalMultimodal}
          onChange={(event) => onExternalMultimodalChange(event.target.checked)}
          disabled={createPending}
        />
        {t('create_dialog.multimodal_enabled')}
      </label>
      <div className="space-y-2">
        <label className="text-sm text-primary">{t('create_dialog.accepted_mime_types')}</label>
        <Input
          value={externalAcceptedMimeTypes}
          onChange={(event) => onExternalAcceptedMimeTypesChange(event.target.value)}
          placeholder="image/png,image/jpeg"
          disabled={createPending}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-sm text-primary">{t('create_dialog.max_file_count')}</label>
          <Input
            type="number"
            min={1}
            value={externalMaxFileCount}
            onChange={(event) => onExternalMaxFileCountChange(event.target.value)}
            disabled={createPending}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-primary">{t('create_dialog.max_total_bytes')}</label>
          <Input
            type="number"
            min={1024}
            value={externalMaxTotalBytes}
            onChange={(event) => onExternalMaxTotalBytesChange(event.target.value)}
            disabled={createPending}
          />
        </div>
      </div>
    </div>
  );
}
