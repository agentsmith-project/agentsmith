---
{
  "storyId": "mock-lane-notebook-task-lifecycle",
  "title": "Mock lane notebook task lifecycle scenes",
  "actor": "authenticated project member",
  "lane": "mock-lane",
  "family": "notebook-task-lifecycle",
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/notebook",
  "goal": "用一组 mock-lane story scenes 统一描述 notebook task 从列表、创建、详情到产物检查的高频任务生命周期。",
  "narrative": "Notebook task lifecycle scenes cover the list view, the create-task dialog, the task detail surface, and the artifact inspection hover state that a member uses when working through a task.",
  "preconditions": [
    "workspace ws_default and project proj_001 are available in the mock lane"
  ],
  "scenes": [
    {
      "sceneId": "notebook-task-lifecycle-list",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-list",
        "notebook__task-card",
        "notebook__create-task-btn"
      ]
    },
    {
      "sceneId": "notebook-task-lifecycle-create-dialog",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__create-task-btn"
      ]
    },
    {
      "sceneId": "notebook-task-lifecycle-detail",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__conversation-input",
        "notebook__send-btn"
      ]
    },
    {
      "sceneId": "notebook-task-lifecycle-artifact",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__artifact-card",
        "notebook__artifact-hover-panel"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "notebook-task-lifecycle-open-list",
      "sceneId": "notebook-task-lifecycle-list",
      "intent": "Open the notebook task list and confirm the create-task affordance is visible.",
      "action": "Open notebook",
      "target": "notebook__create-task-btn",
      "expectedFeedback": "Notebook task list is ready for task work.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "notebook-task-lifecycle-open-create-dialog",
      "sceneId": "notebook-task-lifecycle-create-dialog",
      "intent": "Open the create-task dialog so a new notebook task can be started.",
      "action": "Create notebook task",
      "target": "notebook__create-task-btn",
      "expectedFeedback": "Create-task dialog is visible and keeps the lifecycle in one continuous flow.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "notebook-task-lifecycle-open-detail",
      "sceneId": "notebook-task-lifecycle-detail",
      "intent": "Open a notebook task detail view and continue the task conversation.",
      "action": "Open notebook task",
      "target": "notebook__task-header",
      "expectedFeedback": "Task detail, conversation input, and send action are visible.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "notebook-task-lifecycle-open-artifact",
      "sceneId": "notebook-task-lifecycle-artifact",
      "intent": "Hover an artifact to confirm the lifecycle reached a reviewable output state.",
      "action": "Inspect notebook artifact",
      "target": "notebook__artifact-card",
      "expectedFeedback": "Artifact preview hover is visible.",
      "evidence": [
        "trace"
      ]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "notebook-task-lifecycle-list",
          "scenarioId": "notebook-task-lifecycle-list",
          "scenario": "Notebook task list with a visible create-task call to action.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/page.tsx",
            "src/components/notebook/TaskList.tsx",
            "src/components/notebook/task-list/TaskListHeader.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "happy",
          "semanticAssertions": {
            "requiredViewerLocalDateTimeTestIds": [
              "notebook__task-last-activity",
              "notebook__task-created-at"
            ],
            "requiredViewportTestIds": [
              "notebook__create-task-btn"
            ]
          },
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "notebook-task-lifecycle-create-dialog",
          "scenarioId": "notebook-task-lifecycle-create-dialog",
          "scenario": "Notebook create-task dialog opened from the task list.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/page.tsx",
            "src/components/notebook/TaskList.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "uxState": "happy",
          "semanticAssertions": {
            "forbiddenVisibleText": [
              "Create Task New Task",
              "Create New",
              "Initialize a new workspace automatically",
              "New workspace name",
              "Select Existing Workspace"
            ]
          },
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "notebook-task-lifecycle-detail",
          "scenarioId": "notebook-task-lifecycle-detail",
          "scenario": "Notebook task detail surface with the conversation input and current task header.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskList.tsx",
            "src/components/notebook/task-list/TaskListContent.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "happy",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "notebook-task-lifecycle-artifact",
          "scenarioId": "notebook-task-lifecycle-artifact",
          "scenario": "Notebook artifact hover state on a task detail page.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/notebook/ArtifactCard.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "happy",
          "themes": [
            "light",
            "dark"
          ]
        }
      ]
    }
  },
  "personas": [
    "authenticated project member"
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
Mock lane notebook task lifecycle visual scene family source.
