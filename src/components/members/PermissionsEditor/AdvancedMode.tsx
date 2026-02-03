'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PermissionGroup } from './PermissionGroup';
import { PLATFORM_PERMISSIONS_GROUPED, PERMISSION_DESCRIPTIONS } from '@/lib/constants/permissions';
import { Search, Copy, RotateCw } from 'lucide-react';
import { toast } from '@/components/ui/toast';

export interface AdvancedModeProps {
  selectedPermissions: Set<string>;
  onPermissionToggle: (permission: string, checked: boolean) => void;
  onReset?: () => void;
  initialTemplate?: 'owner' | 'admin' | 'developer' | 'user' | null;
}

export function AdvancedMode({
  selectedPermissions,
  onPermissionToggle,
  onReset,
  initialTemplate,
}: AdvancedModeProps) {
  const t = useTranslations('members.permissions');
  const [searchQuery, setSearchQuery] = React.useState('');

  // Filter permissions based on search query
  const filteredGroups = React.useMemo(() => {
    if (!searchQuery) return PLATFORM_PERMISSIONS_GROUPED;
    const query = searchQuery.toLowerCase();
    return PLATFORM_PERMISSIONS_GROUPED.map((group) => ({
      ...group,
      permissions: group.permissions.filter((p) => p.toLowerCase().includes(query)),
    })).filter((group) => group.permissions.length > 0);
  }, [searchQuery]);

  const handleCopyJSON = () => {
    const permissionsArray = Array.from(selectedPermissions);
    const json = JSON.stringify(permissionsArray, null, 2);
    navigator.clipboard.writeText(json);
    toast.success('Permissions copied to clipboard');
  };

  const handleReset = () => {
    if (initialTemplate && onReset) {
      onReset();
    } else {
      toast.error('No template to reset to');
    }
  };

  const selectedCount = selectedPermissions.size;

  return (
    <div className="space-y-4">
      {/* Search and Actions */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary" />
          <Input
            type="text"
            placeholder={t('search_permissions')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-tertiary">
            {t('selected_count', { count: selectedCount })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyJSON}
            className="gap-2"
          >
            <Copy className="h-4 w-4" />
            {t('copy_json')}
          </Button>
          {initialTemplate && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="gap-2"
            >
              <RotateCw className="h-4 w-4" />
              {t('reset_to_template')}
            </Button>
          )}
        </div>
      </div>

      {/* Permission Groups */}
      <div className="space-y-3 max-h-[600px] overflow-y-auto">
        {filteredGroups.length === 0 ? (
          <div className="text-center py-8 text-tertiary">
            {t('no_permissions_found', { query: searchQuery })}
          </div>
        ) : (
          filteredGroups.map((group) => (
            <PermissionGroup
              key={group.id}
              id={group.id}
              name={group.name}
              permissions={group.permissions}
              selectedPermissions={selectedPermissions}
              onPermissionToggle={onPermissionToggle}
              descriptions={PERMISSION_DESCRIPTIONS}
            />
          ))
        )}
      </div>
    </div>
  );
}
