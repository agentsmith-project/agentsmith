'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useResourceACL, useUpdateResourceACL } from '@/lib/hooks/use-members';
import { RESOURCE_PERMISSIONS } from '@/lib/constants/permissions';
import { LoadingSpinner } from '@/components/ui/loading';

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
}

export interface KBPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kb: KnowledgeBase;
  workspaceId: string;
  projectId: string;
  memberId: string;
  memberName: string;
  onSuccess?: () => void;
}

export function KBPermissionsDialog({
  open,
  onOpenChange,
  kb,
  workspaceId,
  projectId,
  memberId,
  memberName,
  onSuccess,
}: KBPermissionsDialogProps) {
  const t = useTranslations('members.acl');
  const { data: acl, isLoading } = useResourceACL(
    workspaceId,
    projectId,
    'kb',
    kb.id
  );
  const { mutate: updateACL, isPending } = useUpdateResourceACL(
    workspaceId,
    projectId,
    'kb',
    kb.id
  );

  const [selectedPermissions, setSelectedPermissions] = React.useState<Set<string>>(new Set());

  // Initialize selected permissions from ACL
  React.useEffect(() => {
    if (acl) {
      const allowEntry = acl.allow.find((a) => a.subject_id === memberId);
      if (allowEntry) {
        setSelectedPermissions(new Set(allowEntry.permissions));
      } else {
        setSelectedPermissions(new Set());
      }
    }
  }, [acl, memberId]);

  const kbPermissions = RESOURCE_PERMISSIONS.KB;

  const handlePermissionToggle = React.useCallback((permission: string, checked: boolean) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(permission);
      } else {
        next.delete(permission);
      }
      return next;
    });
  }, []);

  const handleSave = React.useCallback(() => {
    const currentAllow = acl?.allow.find((a) => a.subject_id === memberId);
    const currentPermissions = currentAllow?.permissions || [];
    const newPermissions = Array.from(selectedPermissions);

    // Calculate changes
    const added = newPermissions.filter((p) => !currentPermissions.includes(p));
    const removed = currentPermissions.filter((p) => !newPermissions.includes(p));

    const ops: Array<{
      op: 'allow' | 'deny' | 'remove_deny';
      subject_type: 'user';
      subject_id: string;
      permissions: string[];
      reason?: string;
    }> = [];

    if (added.length > 0 || removed.length > 0) {
      // Remove old allow entry if exists
      if (currentAllow) {
        ops.push({
          op: 'allow',
          subject_type: 'user',
          subject_id: memberId,
          permissions: [], // Remove all
        });
      }

      // Add new allow entry
      if (newPermissions.length > 0) {
        ops.push({
          op: 'allow',
          subject_type: 'user',
          subject_id: memberId,
          permissions: newPermissions,
        });
      }
    }

    if (ops.length > 0) {
      updateACL(
        { ops },
        {
          onSuccess: () => {
            onOpenChange(false);
            onSuccess?.();
          },
        }
      );
    } else {
      onOpenChange(false);
    }
  }, [selectedPermissions, acl, memberId, updateACL, onOpenChange, onSuccess]);

  const handleCancel = React.useCallback(() => {
    // Reset to original permissions
    if (acl) {
      const allowEntry = acl.allow.find((a) => a.subject_id === memberId);
      if (allowEntry) {
        setSelectedPermissions(new Set(allowEntry.permissions));
      } else {
        setSelectedPermissions(new Set());
      }
    }
    onOpenChange(false);
  }, [acl, memberId, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('kb.edit_permissions')}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center items-center h-60">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-sm text-tertiary">KB</Label>
              <p className="text-sm font-medium text-foreground mt-1">{kb.name}</p>
            </div>

            <div>
              <Label className="text-sm text-tertiary">User</Label>
              <p className="text-sm font-medium text-foreground mt-1">{memberName}</p>
            </div>

            <div>
              <Label className="text-sm font-medium text-foreground mb-3 block">
                Permissions
              </Label>
              <div className="space-y-2 border border-border rounded-md p-4">
                {kbPermissions.map((permission) => (
                  <div
                    key={permission}
                    className="flex items-center space-x-2 py-2 hover:bg-hover/50 rounded-sm px-2"
                  >
                    <Checkbox
                      id={permission}
                      checked={selectedPermissions.has(permission)}
                      onCheckedChange={(checked) =>
                        handlePermissionToggle(permission, checked as boolean)
                      }
                    />
                    <label
                      htmlFor={permission}
                      className="text-sm font-mono text-foreground cursor-pointer flex-1"
                    >
                      {permission}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending || isLoading}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
