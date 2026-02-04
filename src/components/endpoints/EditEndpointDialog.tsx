import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EndpointAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import type { Endpoint } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';

export interface EditEndpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  endpoint: Endpoint;
  onSuccess?: () => void;
}

export function EditEndpointDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  endpoint,
  onSuccess,
}: EditEndpointDialogProps) {
  const t = useTranslations('endpoints');
  const [name, setName] = React.useState(endpoint.name);
  const [description, setDescription] = React.useState(endpoint.description ?? '');
  const [openaiModel, setOpenaiModel] = React.useState(endpoint.openai_model);
  const [baseUrl, setBaseUrl] = React.useState(endpoint.base_url);
  const [status, setStatus] = React.useState<'active' | 'disabled'>(endpoint.status);
  const [isSaving, setIsSaving] = React.useState(false);

  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);

  React.useEffect(() => {
    if (!open) return;
    setName(endpoint.name);
    setDescription(endpoint.description ?? '');
    setOpenaiModel(endpoint.openai_model);
    setBaseUrl(endpoint.base_url);
    setStatus(endpoint.status);
  }, [open, endpoint]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !openaiModel.trim() || !baseUrl.trim()) return;
    setIsSaving(true);
    try {
      await endpointAPI.update(workspaceId, projectId, endpoint.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        openai_model: openaiModel.trim(),
        base_url: baseUrl.trim(),
        status,
      });
      toast.success(t('edit_dialog.success'));
      onSuccess?.();
    } catch (error) {
      handleErrorForToast(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !isSaving) onOpenChange(next);
  };

  const canSubmit =
    name.trim().length > 0 &&
    openaiModel.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    !isSaving;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('edit_dialog.title')}</DialogTitle>
          <DialogDescription>{t('edit_dialog.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="endpoint-name" className="text-sm font-medium text-foreground">
              {t('create_dialog.name')} <span className="text-error">*</span>
            </label>
            <Input
              id="endpoint-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSaving}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="endpoint-description" className="text-sm font-medium text-foreground">
              {t('create_dialog.description')}
            </label>
            <textarea
              id="endpoint-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={isSaving}
              className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="endpoint-model" className="text-sm font-medium text-foreground">
              {t('create_dialog.model_id')} <span className="text-error">*</span>
            </label>
            <Input
              id="endpoint-model"
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              disabled={isSaving}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="endpoint-base-url" className="text-sm font-medium text-foreground">
              {t('create_dialog.base_url')} <span className="text-error">*</span>
            </label>
            <Input
              id="endpoint-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={isSaving}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="endpoint-status" className="text-sm font-medium text-foreground">
              {t('status')}
            </label>
            <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'disabled')}>
              <SelectTrigger id="endpoint-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t('status_active')}</SelectItem>
                <SelectItem value="disabled">{t('status_disabled')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
              {t('edit_dialog.cancel')}
            </Button>
            <Button variant="default" type="submit" disabled={!canSubmit}>
              {t('edit_dialog.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
