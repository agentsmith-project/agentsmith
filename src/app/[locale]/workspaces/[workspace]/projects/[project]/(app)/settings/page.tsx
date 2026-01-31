/**
 * Settings Page
 *
 * Project settings and configuration.
 */

'use client';

import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';

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
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SettingsIcon className="w-6 h-6" />
          Settings
        </h1>
        <p className="text-muted-foreground">Manage project configuration</p>
      </div>

      <div className="space-y-6">
        {/* General Settings */}
        <div className="p-6 rounded-lg border bg-card">
          <h2 className="font-semibold mb-4">General</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Project Name</label>
              <input
                type="text"
                defaultValue={currentProject.name}
                className="w-full px-3 py-2 rounded-md border border-input bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                placeholder="Add a description..."
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-input bg-background"
              />
            </div>
          </div>
        </div>

        {/* Access Control */}
        <div className="p-6 rounded-lg border bg-card">
          <h2 className="font-semibold mb-4">Access Control</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Visibility</label>
              <select
                defaultValue={currentProject.visibility || 'private'}
                className="w-full px-3 py-2 rounded-md border border-input bg-background"
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Join Policy</label>
              <select
                defaultValue="approval_required"
                className="w-full px-3 py-2 rounded-md border border-input bg-background"
              >
                <option value="approval_required">Approval Required</option>
                <option value="open">Open</option>
              </select>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="p-6 rounded-lg border border-destructive/50 bg-destructive/5">
          <h2 className="font-semibold text-destructive mb-4">Danger Zone</h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Delete Project</div>
              <div className="text-sm text-muted-foreground">Permanently delete this project and all data</div>
            </div>
            <button className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors">
              Delete Project
            </button>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
