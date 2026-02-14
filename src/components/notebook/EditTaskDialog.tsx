'use client';

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
import { Loader2 } from 'lucide-react';
import type { Task, TaskStatus } from '@/lib/types/task';

export interface EditTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  saving?: boolean;
  onSubmit: (data: { title: string; status: TaskStatus }) => Promise<void> | void;
}

export function EditTaskDialog({
  open,
  onOpenChange,
  task,
  saving = false,
  onSubmit,
}: EditTaskDialogProps) {
  const t = useTranslations('notebook.task');
  const commonT = useTranslations('common');
  const [title, setTitle] = React.useState(task.title);
  const [status, setStatus] = React.useState<TaskStatus>(task.status);

  React.useEffect(() => {
    if (!open) return;
    setTitle(task.title);
    setStatus(task.status);
  }, [open, task.title, task.status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await onSubmit({ title: title.trim(), status });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('edit_title')}</DialogTitle>
          <DialogDescription>{t('edit_description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="task-edit-title" className="text-sm font-medium text-foreground">
              {t('create_title')}
            </label>
            <Input
              id="task-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              required
              data-testid="notebook__edit-task-title"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="task-edit-status" className="text-sm font-medium text-foreground">
              {t('status_label')}
            </label>
            <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)} disabled={saving}>
              <SelectTrigger id="task-edit-status" data-testid="notebook__edit-task-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t('status.active')}</SelectItem>
                <SelectItem value="closed">{t('status.closed')}</SelectItem>
                <SelectItem value="archived">{t('status.archived')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              {commonT('cancel')}
            </Button>
            <Button type="submit" disabled={saving || !title.trim()} data-testid="notebook__edit-task-save">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save_changes')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
