'use client';
import * as React from 'react';
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
import { AlertCircle, Loader2 } from 'lucide-react';
import { useCreateRecipe } from '@/lib/hooks/use-recipe';
import { useQuery } from '@tanstack/react-query';
import { AgentAPI, getApiClient } from '@/lib/api';
import type { CreateRecipeRequest } from '@/lib/types/recipe';

export interface RecipeCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: (recipeId: string) => void;
}

export function RecipeCreateDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: RecipeCreateDialogProps) {
  const [title, setTitle] = React.useState('');
  const [agentId, setAgentId] = React.useState<string>('');
  const createRecipe = useCreateRecipe();

  // Fetch available agents
  const agentAPI = new AgentAPI(getApiClient());
  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId],
    queryFn: () => agentAPI.list(workspaceId, projectId),
    enabled: open && !!workspaceId && !!projectId,
  });

  const agents = agentsData?.items || [];

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setTitle('');
      setAgentId('');
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !agentId) {
      return;
    }

    const data: CreateRecipeRequest = {
      title: title.trim(),
      agent_id: agentId,
    };

    try {
      const recipe = await createRecipe.mutateAsync({
        workspaceId,
        projectId,
        data,
      });
      onOpenChange(false);
      if (onSuccess) {
        onSuccess(recipe.id);
      }
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const canSubmit = title.trim().length > 0 && agentId.length > 0 && !createRecipe.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Recipe</DialogTitle>
          <DialogDescription>
            Create a new Recipe to work with an agent. The agent cannot be changed after creation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="recipe-title" className="text-sm font-medium text-foreground">
              Recipe Title
            </label>
            <Input
              id="recipe-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter recipe title"
              disabled={createRecipe.isPending}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="recipe-agent" className="text-sm font-medium text-foreground">
              Select Agent
            </label>
            <Select value={agentId} onValueChange={setAgentId} disabled={createRecipe.isPending}>
              <SelectTrigger id="recipe-agent">
                <SelectValue placeholder="Choose an agent" />
              </SelectTrigger>
              <SelectContent>
                {agentsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-tertiary" />
                  </div>
                ) : agents.length === 0 ? (
                  <div className="py-4 text-center text-sm text-tertiary">No agents available</div>
                ) : (
                  agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md bg-surface-high border border-subtle p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
            <div className="text-xs text-tertiary space-y-1">
              <p className="font-medium text-foreground">Important:</p>
              <p>• The agent cannot be changed after creation</p>
              <p>• Conversation history cannot be modified</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createRecipe.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createRecipe.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Recipe
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
