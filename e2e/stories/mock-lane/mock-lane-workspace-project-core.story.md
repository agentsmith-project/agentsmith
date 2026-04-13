---
{
  "storyId": "mock-lane-workspace-project-core",
  "title": "Mock lane workspace/project core visual scenes",
  "actor": "workspace admin / project owner / authenticated member / guest",
  "lane": "mock-lane",
  "entryRoute": "/en-US/workspaces/ws_default",
  "goal": "统一描述 workspace 与 project 核心工作面的 mock-lane visual scene 真相。",
  "narrative": "Workspace/project core scenes cover workspace home, project discovery, overview, chat, notebook, files, and the key modal states in that workflow without mixing in connection lifecycle management.",
  "scenes": [
    {
      "sceneId": "workspace-home-project-creator",
      "route": "/en-US/workspaces/ws_default",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "projects-list",
      "route": "/en-US/workspaces/ws_default/projects",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "projects-list-public-discovery",
      "route": "/en-US/workspaces/ws_default/projects",
      "recipeFamily": "work_surface_standard",
      "authLane": "guest",
      "stableMarkers": []
    },
    {
      "sceneId": "dialog-project-join-request",
      "route": "/en-US/workspaces/ws_default/projects",
      "recipeFamily": "overlay_dialog",
      "authLane": "guest",
      "stableMarkers": []
    },
    {
      "sceneId": "dialog-project-join-now",
      "route": "/en-US/workspaces/ws_default/projects",
      "recipeFamily": "overlay_dialog",
      "authLane": "guest",
      "stableMarkers": []
    },
    {
      "sceneId": "notification-center-join-request",
      "route": "/en-US/workspaces/ws_default/projects",
      "recipeFamily": "overlay_sheet",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "projects-empty",
      "route": "/en-US/workspaces/ws_test/projects",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "workspace-settings-create-project",
      "route": "/en-US/workspaces/ws_default/settings",
      "recipeFamily": "overlay_sheet",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "workspace-overview",
      "route": "/en-US/workspaces/overview",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "workspace-home",
      "route": "/en-US/workspaces/ws_default",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "workspace-settings",
      "route": "/en-US/workspaces/ws_default/settings",
      "recipeFamily": "settings_sheet",
      "authLane": "authed",
      "stableMarkers": [
        "ws-settings__summary-line",
        "ws-settings__workspace",
        "ws-settings__integrations",
        "ws-settings__projects"
      ]
    },
    {
      "sceneId": "workspace-personal-context",
      "route": "/en-US/workspaces/ws_default/context",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": [
        "context-store__list-card",
        "context-store__editor-card"
      ]
    },
    {
      "sceneId": "project-overview",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/overview",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": [
        "project-hub__summary",
        "project-hub__use-summary",
        "project-hub__governance-summary"
      ]
    },
    {
      "sceneId": "chat-standard",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "chat__surface",
        "chat__threads-pane",
        "chat__main-pane",
        "chat__header",
        "chat__composer"
      ]
    },
    {
      "sceneId": "chat-ultrawide",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "notebook",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "notebook-create-task-dialog",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "notebook-task-detail",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "notebook-task-detail-artifact-hover",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "files",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/files",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "files__workspace-surface",
        "files__workspace-grid",
        "files__libraries-shell",
        "files__browser-shell",
        "files__library-list",
        "files__objects-table"
      ]
    },
    {
      "sceneId": "files-selection-details",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/files",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "files__workspace-surface",
        "files__details-shell",
        "files__details-inspector"
      ]
    },
    {
      "sceneId": "dialog-files-create-folder",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/files",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "dialog-files-rename",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/files",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "dialog-files-mount-access",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/files",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "dialog-files-library-create",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/files",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "dialog-files-library-delete",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/files",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    }
  ],
  "steps": [
    {
      "stepId": "open-workspace-home",
      "sceneId": "workspace-home-project-creator",
      "intent": "Open the workspace home surface.",
      "action": "Open workspace home",
      "target": "projects__create-btn",
      "expectedFeedback": "workspace home 入口可用于创建项目。",
      "note": "workspace/project core should remain a quiet work surface.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-project-overview",
      "sceneId": "project-overview",
      "intent": "Open the project overview surface.",
      "action": "Open project overview",
      "target": "project-overview__heading",
      "expectedFeedback": "project overview 页面可见。",
      "note": "overview 仍是 project work surface 的入口。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "workspace-home-project-creator",
          "scenarioId": "workspace-home-project-creator",
          "scenario": "Workspace home for a project creator with create-project affordance visible.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/workspaces/WorkspaceProjectsEntryPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "projects-list",
          "scenarioId": "projects-list",
          "scenario": "Workspace projects list for an authenticated member.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/workspaces/WorkspaceProjectsEntryPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "projects-list-public-discovery",
          "scenarioId": "projects-list-public-discovery",
          "scenario": "Guest discovery view that exposes join/request actions without private projects.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/workspaces/WorkspaceProjectsEntryPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "guest",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "dialog-project-join-request",
          "scenarioId": "dialog-project-join-request",
          "scenario": "Join-request dialog for a protected project.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/workspaces/WorkspaceProjectsEntryPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "guest",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "dialog-project-join-now",
          "scenarioId": "dialog-project-join-now",
          "scenario": "Immediate join confirmation dialog for an open project.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/workspaces/WorkspaceProjectsEntryPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "guest",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "notification-center-join-request",
          "scenarioId": "notification-center-join-request",
          "scenario": "Notification center open with join-request outcome messages.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/app-shell/Topbar.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "projects-empty",
          "scenarioId": "projects-empty",
          "scenario": "Empty projects state in a workspace with no projects yet.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/workspaces/WorkspaceProjectsEntryPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "workspace-settings-create-project",
          "scenarioId": "workspace-settings-create-project",
          "scenario": "Create-project flow opened from workspace settings.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/settings/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "workspace-overview",
          "scenarioId": "workspace-overview",
          "scenario": "Workspace overview page.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/overview/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "workspace-home",
          "scenarioId": "workspace-home",
          "scenario": "Workspace home with project entry surface.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/workspaces/WorkspaceProjectsEntryPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "workspace-settings",
          "scenarioId": "workspace-settings",
          "scenario": "Workspace settings page.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/settings/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "workspace-personal-context",
          "scenarioId": "workspace-personal-context",
          "scenario": "Workspace personal context page for the current member.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/context/page.tsx",
            "src/components/context/ContextManager.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "project-overview",
          "scenarioId": "overview",
          "scenario": "Project overview work surface.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "chat-standard",
          "scenarioId": "chat-standard",
          "scenario": "Standard chat work surface.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "chat-ultrawide",
          "scenarioId": "chat-ultrawide",
          "scenario": "Chat work surface in ultrawide layout.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "viewport": "ultrawide",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "notebook",
          "scenarioId": "notebook",
          "scenario": "Notebook list work surface.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "notebook-create-task-dialog",
          "scenarioId": "notebook-create-task-dialog",
          "scenario": "Create task dialog opened from notebook.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "notebook-task-detail",
          "scenarioId": "notebook-task-detail",
          "scenario": "Notebook task detail surface.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "notebook-task-detail-artifact-hover",
          "scenarioId": "notebook-task-detail-artifact-hover",
          "scenario": "Notebook task detail with artifact hover state visible.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "files",
          "scenarioId": "files",
          "scenario": "Files workbench with library browser.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/files/FilesPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "files-selection-details",
          "scenarioId": "files-selection-details",
          "scenario": "Files page with selection and details panel visible.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/files/files-page/FilesPageContent.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "dialog-files-create-folder",
          "scenarioId": "dialog-files-create-folder",
          "scenario": "Create-folder dialog in files.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/files/files-page/FilesPageContent.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "dialog-files-rename",
          "scenarioId": "dialog-files-rename",
          "scenario": "Rename dialog in files.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/files/files-page/FilesPageContent.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "dialog-files-mount-access",
          "scenarioId": "dialog-files-mount-access",
          "scenario": "Desktop mount access dialog.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/files/files-page/FilesPageContent.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "dialog-files-library-create",
          "scenarioId": "dialog-files-library-create",
          "scenario": "Create library dialog.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/files/files-page/FilesPageContent.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "dialog-files-library-delete",
          "scenarioId": "dialog-files-library-delete",
          "scenario": "Delete non-empty library dialog.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/files/files-page/FilesPageContent.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        }
      ]
    }
  },
  "family": "mock-lane-workspace-project-core",
  "personas": [
    "workspace admin",
    "project owner",
    "authenticated member",
    "guest"
  ],
  "kind": "journey",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": []
}
---
Mock lane workspace/project core visual scene family source.
