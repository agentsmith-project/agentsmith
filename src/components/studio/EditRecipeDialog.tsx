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
import type { Recipe, RecipeStatus } from '@/lib/types/recipe';

export interface EditRecipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: Recipe;
  saving?: boolean;
  onSubmit: (data: { title: string; status: RecipeStatus }) => Promise<void> | void;
}

export function EditRecipeDialog({
  open,
  onOpenChange,
  recipe,
  saving = false,
  onSubmit,
}: EditRecipeDialogProps) {
  const t = useTranslations('studio.recipe');
  const commonT = useTranslations('common');
  const [title, setTitle] = React.useState(recipe.title);
  const [status, setStatus] = React.useState<RecipeStatus>(recipe.status);

  React.useEffect(() => {
    if (!open) return;
    setTitle(recipe.title);
    setStatus(recipe.status);
  }, [open, recipe.title, recipe.status]);

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
            <label htmlFor="recipe-edit-title" className="text-sm font-medium text-foreground">
              {t('create_title')}
            </label>
            <Input
              id="recipe-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              required
              data-testid="studio__edit-recipe-title"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="recipe-edit-status" className="text-sm font-medium text-foreground">
              {t('status_label')}
            </label>
            <Select value={status} onValueChange={(v) => setStatus(v as RecipeStatus)} disabled={saving}>
              <SelectTrigger id="recipe-edit-status" data-testid="studio__edit-recipe-status">
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
            <Button type="submit" disabled={saving || !title.trim()} data-testid="studio__edit-recipe-save">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save_changes')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
