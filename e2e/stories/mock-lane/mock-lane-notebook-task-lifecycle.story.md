---
{
  "storyId": "mock-lane-notebook-task-lifecycle",
  "title": "Mock lane notebook task lifecycle scenes",
  "actor": "authenticated project member",
  "lane": "mock-lane",
  "family": "notebook-task-lifecycle",
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/notebook",
  "goal": "用一组 mock-lane story scenes 统一描述 notebook task 的列表、创建、详情、产物检查，以及 cancel / force-stop confirm / provider error / SSE / terminal blocker 这些必须按用户心智说真话的状态同步时刻。",
  "narrative": "Notebook task lifecycle scenes cover the task list, the create-task dialog, the task detail surface, artifact inspection, and the blocked or degraded states a member must understand when a run is stopping, a force-stop confirmation is required, a provider error still leaves the same task recoverable, realtime updates are recovering, or terminal truth has not settled yet.",
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
    },
    {
      "sceneId": "notebook-task-running",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__message-active-run-footer",
        "notebook__message-active-run-cancel",
        "notebook__conversation-input"
      ]
    },
    {
      "sceneId": "notebook-task-running-long-action-narrow",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__message-active-run-footer",
        "notebook__message-active-run-latest-action",
        "notebook__message-active-run-cancel",
        "notebook__conversation-input"
      ]
    },
    {
      "sceneId": "notebook-task-cancelling",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__run-activity-summary",
        "notebook__conversation-input",
        "notebook__send-btn"
      ]
    },
    {
      "sceneId": "notebook-cancel-escalation-confirm",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__cancel-escalation-dialog",
        "notebook__cancel-escalation-cancel",
        "notebook__cancel-escalation-confirm"
      ]
    },
    {
      "sceneId": "notebook-task-terminating",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__run-activity-summary",
        "notebook__conversation-input",
        "notebook__send-btn"
      ]
    },
    {
      "sceneId": "notebook-task-finalizing",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__run-activity-summary",
        "notebook__conversation-input",
        "notebook__send-btn"
      ]
    },
    {
      "sceneId": "notebook-sse-reconnecting",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__execution-visibility",
        "notebook__sse-status",
        "notebook__conversation-input",
        "notebook__send-btn"
      ]
    },
    {
      "sceneId": "notebook-sse-unavailable-reconcile",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__execution-visibility",
        "notebook__sse-status",
        "notebook__sse-status-open-audit",
        "notebook__sse-status-open-usage"
      ]
    },
    {
      "sceneId": "notebook-task-recovered-ready",
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
      "sceneId": "notebook-provider-upstream-error",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__agent-message-bubble",
        "notebook__message-run-status",
        "notebook__send-btn"
      ]
    },
    {
      "sceneId": "notebook-hidden-terminal-blocked",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__task-terminal-status-strip",
        "notebook__task-terminal-status-action",
        "notebook__task-terminal-status-end-all"
      ]
    },
    {
      "sceneId": "notebook-terminal-truth-unavailable",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__task-terminal-truth-unavailable",
        "notebook__task-terminal-truth-unavailable-retry"
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
              "notebook__task-card--task_001::notebook__task-last-activity",
              "notebook__task-card--task_001::notebook__task-created-at",
              "notebook__task-card--task_002::notebook__task-last-activity",
              "notebook__task-card--task_002::notebook__task-created-at"
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
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/components/notebook/ConversationInput.tsx",
            "src/components/notebook/TaskHeader.tsx"
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
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ArtifactCard.tsx"
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
          "sceneId": "notebook-task-running",
          "scenarioId": "notebook-task-running",
          "scenario": "The current task is actively running, with the AI message active footer showing latest-action context and a same-surface stop affordance instead of a silent busy state.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/components/notebook/ConversationInput.tsx",
            "src/components/notebook/TaskHeader.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "happy",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__message-active-run-footer",
              "notebook__message-active-run-status",
              "notebook__message-active-run-elapsed",
              "notebook__message-active-run-latest-action",
              "notebook__message-active-run-cancel",
              "notebook__conversation-input"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-task-running-long-action-narrow",
          "scenarioId": "notebook-task-running-long-action-narrow",
          "scenario": "The active AI message footer stays single-row on a narrower desktop viewport when the latest action is a long command, keeping the cancel affordance visible with its full accessible name.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/components/notebook/MessageItem.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "happy",
          "setupNotes": [
            "viewport:1100x700"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__message-active-run-footer",
              "notebook__message-active-run-status",
              "notebook__message-active-run-elapsed",
              "notebook__message-active-run-latest-action",
              "notebook__message-active-run-cancel",
              "notebook__conversation-input"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-task-cancelling",
          "scenarioId": "notebook-task-cancelling",
          "scenario": "The member already requested cancel, so the task clearly says stopping is in progress and holds the next turn until stop truth settles.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/components/notebook/ConversationInput.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "diagnostic",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__run-activity-summary",
              "notebook__conversation-input",
              "notebook__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "notebook__conversation-input"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-cancel-escalation-confirm",
          "scenarioId": "notebook-cancel-escalation-confirm",
          "scenario": "Cancel has not settled in time, so the same task asks for an explicit force-stop confirmation before escalating the run.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/notebook/TaskPage.tsx",
            "src/components/ui/alert-dialog.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "uxState": "degraded",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__cancel-escalation-dialog",
              "notebook__cancel-escalation-cancel",
              "notebook__cancel-escalation-confirm"
            ],
            "prominentActionScopeTestIds": [
              "notebook__cancel-escalation-dialog"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-task-terminating",
          "scenarioId": "notebook-task-terminating",
          "scenario": "Cancel escalated to terminate, and the task makes the stronger stop state explicit before allowing any new run to begin.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/components/notebook/ConversationInput.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "diagnostic",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__run-activity-summary",
              "notebook__conversation-input",
              "notebook__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "notebook__conversation-input"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-task-finalizing",
          "scenarioId": "notebook-task-finalizing",
          "scenario": "Execution already ended and the task is still saving the final answer and artifacts, so the member sees a real finishing state instead of a fake idle reset.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/components/notebook/ConversationInput.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "diagnostic",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__run-activity-summary",
              "notebook__conversation-input",
              "notebook__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "notebook__conversation-input"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-sse-reconnecting",
          "scenarioId": "notebook-sse-reconnecting",
          "scenario": "The same task is still open while the live task stream reconnects, so the member can understand the temporary gap without losing the task surface.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/lib/hooks/use-task-sse.ts"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "diagnostic",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__sse-status",
              "notebook__conversation-input",
              "notebook__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "notebook__conversation-input"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-sse-unavailable-reconcile",
          "scenarioId": "notebook-sse-unavailable-reconcile",
          "scenario": "Live updates cannot currently be trusted, so the task surfaces manual recovery guidance and diagnostics links before the member blindly keeps going.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/lib/build-failure-explainability.ts",
            "src/lib/hooks/use-task-sse.ts"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "degraded",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__sse-status",
              "notebook__sse-status-open-audit",
              "notebook__sse-status-open-usage"
            ],
            "prominentActionScopeTestIds": [
              "notebook__execution-visibility"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-task-recovered-ready",
          "scenarioId": "notebook-task-recovered-ready",
          "scenario": "After stop or reconnect truth settles, the same task returns to ready state so the member can continue without cloning a replacement task.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/components/notebook/ConversationInput.tsx",
            "src/components/notebook/TaskHeader.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "happy",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__conversation-input",
              "notebook__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "notebook__conversation-input"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-provider-upstream-error",
          "scenarioId": "notebook-provider-upstream-error",
          "scenario": "The task stays recoverable after a provider failure by keeping the latest upstream guidance visible and leaving the same conversation ready for the next retry.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/ConversationPanel.tsx",
            "src/components/notebook/MessageItem.tsx",
            "src/components/notebook/message-item/utils.ts"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "degraded",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__agent-message-bubble",
              "notebook__message-run-status",
              "notebook__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "notebook__conversation-input"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-hidden-terminal-blocked",
          "scenarioId": "notebook-hidden-terminal-blocked",
          "scenario": "Hidden terminal sessions still occupy the same task, so the conversation surface stays fail-closed with reopen or end-session guidance instead of pretending the task is free.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/TaskHeader.tsx",
            "src/components/notebook/terminal-session-summary.ts"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "degraded",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__task-terminal-status-strip",
              "notebook__task-terminal-status-action",
              "notebook__task-terminal-status-end-all"
            ],
            "prominentActionScopeTestIds": [
              "notebook__task-terminal-status-strip"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
        },
        {
          "sceneId": "notebook-terminal-truth-unavailable",
          "scenarioId": "notebook-terminal-truth-unavailable",
          "scenario": "Backend terminal truth is temporarily unavailable, so the task stays fail-closed until the member retries terminal status from this same surface.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx",
            "src/components/notebook/TaskPage.tsx",
            "src/components/notebook/TaskHeader.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "degraded",
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "notebook__task-header",
              "notebook__task-terminal-truth-unavailable",
              "notebook__task-terminal-truth-unavailable-retry"
            ],
            "prominentActionScopeTestIds": [
              "notebook__task-terminal-truth-unavailable"
            ],
            "maxProminentActions": 0,
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ]
          }
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
