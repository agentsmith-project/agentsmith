/**
 * Settings Page
 *
 * Project settings and configuration.
 */

'use client';

import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { Button } from '@/components/ui/button';

interface SettingsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function SettingsPage({ params }: SettingsPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const handleSave = () => {
    setSaving(true);
    // Simulate save
    setTimeout(() => setSaving(false), 1000);
  };

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-icon-default" />
          Settings
        </h1>
        <p className="text-tertiary">Manage project configuration</p>
      </div>

      <div className="space-y-6">
        {/* General Settings */}
        <div className="p-6 rounded-md border border-border bg-surface">
          <h2 className="font-semibold text-foreground mb-4">General</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-primary mb-2">Project Name</label>
              <input
                type="text"
                defaultValue={currentProject.name}
                className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-primary mb-2">Description</label>
              <textarea
                placeholder="Add a description..."
                rows={3}
                className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
          </div>
        </div>

        {/* Access Control */}
        <div className="p-6 rounded-md border border-border bg-surface">
          <h2 className="font-semibold text-foreground mb-4">Access Control</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-primary mb-2">Visibility</label>
              <select
                defaultValue={currentProject.visibility || 'private'}
                className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-primary mb-2">Join Policy</label>
              <select
                defaultValue="approval_required"
                className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="approval_required">Approval Required</option>
                <option value="open">Open</option>
              </select>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="p-6 rounded-md border border-subtle bg-surface-high border-l-2 border-l-error/70">
          <h2 className="font-semibold text-error mb-4">Danger Zone</h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">Delete Project</div>
              <div className="text-sm text-tertiary">Permanently delete this project and all data</div>
            </div>
            <Button variant="destructive">
              Delete Project
            </Button>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            variant="action"
            size="lg"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
