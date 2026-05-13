---
{
  "storyId": "mock-lane-agent-task-lifecycle",
  "title": "Mock lane agent task lifecycle scenes",
  "actor": "authenticated project member",
  "lane": "mock-lane",
  "family": "agent-task-lifecycle",
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks",
  "goal": "用一组 mock-lane story scenes 统一描述 agent task 的列表、创建、详情、产物检查，以及 cancel / force-stop confirm / provider error / SSE / terminal blocker 这些必须按用户心智说真话的状态同步时刻。",
  "narrative": "Agent task lifecycle scenes cover the task list, the create-task dialog, the task detail surface, artifact inspection, and the blocked or degraded states a member must understand when a run is stopping, a force-stop confirmation is required, a provider error still leaves the same task recoverable, realtime updates are recovering, or terminal truth has not settled yet.",
  "preconditions": [
    "workspace ws_default and project proj_001 are available in the mock lane"
  ],
  "scenes": [
    {
      "sceneId": "agent-task-lifecycle-list",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-tasks__task-list",
        "agent-tasks__task-card",
        "agent-tasks__create-task-btn"
      ]
    },
    {
      "sceneId": "agent-task-lifecycle-create-dialog",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": [
        "agent-tasks__create-task-btn"
      ]
    },
    {
      "sceneId": "agent-task-lifecycle-detail",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn"
      ]
    },
    {
      "sceneId": "agent-task-lifecycle-artifact",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__artifact-card",
        "agent-tasks__artifact-hover-panel"
      ]
    },
    {
      "sceneId": "agent-task-running",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__message-active-run-footer",
        "agent-tasks__message-active-run-cancel",
        "agent-tasks__conversation-input"
      ]
    },
    {
      "sceneId": "agent-task-running-long-action-narrow",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__message-active-run-footer",
        "agent-tasks__message-active-run-latest-action",
        "agent-tasks__message-active-run-cancel",
        "agent-tasks__conversation-input"
      ]
    },
    {
      "sceneId": "agent-task-cancelling",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__message-active-run-footer",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn"
      ]
    },
    {
      "sceneId": "agent-task-cancel-escalation-confirm",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__cancel-escalation-dialog",
        "agent-tasks__cancel-escalation-cancel",
        "agent-tasks__cancel-escalation-confirm"
      ]
    },
    {
      "sceneId": "agent-task-terminating",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__message-active-run-footer",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn"
      ]
    },
    {
      "sceneId": "agent-task-finalizing",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__message-active-run-footer",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn"
      ]
    },
    {
      "sceneId": "agent-task-sse-reconnecting",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__message-active-run-footer",
        "agent-tasks__message-active-run-status",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn"
      ]
    },
    {
      "sceneId": "agent-task-sse-unavailable-reconcile",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__execution-visibility",
        "agent-tasks__sse-status"
      ]
    },
    {
      "sceneId": "agent-task-recovered-ready",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn"
      ]
    },
    {
      "sceneId": "agent-task-provider-upstream-error",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__agent-message-bubble",
        "agent-tasks__message-run-status",
        "agent-tasks__send-btn"
      ]
    },
    {
      "sceneId": "agent-task-hidden-terminal-blocked",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__task-terminal-status-strip",
        "agent-tasks__task-terminal-status-action",
        "agent-tasks__task-terminal-status-end-all"
      ]
    },
    {
      "sceneId": "agent-task-terminal-truth-unavailable",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agent-tasks/task_001",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__task-terminal-truth-unavailable",
        "agent-tasks__task-terminal-truth-unavailable-retry"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "agent-task-lifecycle-open-list",
      "sceneId": "agent-task-lifecycle-list",
      "intent": "Open the agent task list and confirm the create-task affordance is visible.",
      "action": "Open agent task",
      "target": "agent-tasks__create-task-btn",
      "expectedFeedback": "Agent task list is ready for task work.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agent-task-lifecycle-open-create-dialog",
      "sceneId": "agent-task-lifecycle-create-dialog",
      "intent": "Open the create-task dialog so a new agent task can be started.",
      "action": "Create agent task",
      "target": "agent-tasks__create-task-btn",
      "expectedFeedback": "Create-task dialog is visible and keeps the lifecycle in one continuous flow.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agent-task-lifecycle-open-detail",
      "sceneId": "agent-task-lifecycle-detail",
      "intent": "Open an agent task detail view and continue the task conversation.",
      "action": "Open agent task",
      "target": "agent-task__task-header",
      "expectedFeedback": "Task detail, conversation input, and send action are visible.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agent-task-lifecycle-open-artifact",
      "sceneId": "agent-task-lifecycle-artifact",
      "intent": "Hover an artifact to confirm the lifecycle reached a reviewable output state.",
      "action": "Inspect agent task artifact",
      "target": "agent-tasks__artifact-card",
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
          "sceneId": "agent-task-lifecycle-list",
          "scenarioId": "agent-task-lifecycle-list",
          "scenario": "Agent task list with a visible create-task call to action.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/page.tsx",
            "src/components/agent-tasks/TaskList.tsx",
            "src/components/agent-tasks/task-list/TaskListHeader.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "uxState": "happy",
          "semanticAssertions": {
            "requiredViewerLocalDateTimeTestIds": [
              "agent-tasks__task-card--task_001::agent-tasks__task-last-activity",
              "agent-tasks__task-card--task_001::agent-tasks__task-created-at",
              "agent-tasks__task-card--task_002::agent-tasks__task-last-activity",
              "agent-tasks__task-card--task_002::agent-tasks__task-created-at"
            ],
            "requiredViewportTestIds": [
              "agent-tasks__create-task-btn"
            ]
          },
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "agent-task-lifecycle-create-dialog",
          "scenarioId": "agent-task-lifecycle-create-dialog",
          "scenario": "Agent task create-task dialog opened from the task list.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/page.tsx",
            "src/components/agent-tasks/TaskList.tsx"
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
          "sceneId": "agent-task-lifecycle-detail",
          "scenarioId": "agent-task-lifecycle-detail",
          "scenario": "Agent task detail surface with the conversation input and current task header.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
            "src/components/agent-tasks/ConversationInput.tsx",
            "src/components/agent-tasks/TaskHeader.tsx"
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
          "sceneId": "agent-task-lifecycle-artifact",
          "scenarioId": "agent-task-lifecycle-artifact",
          "scenario": "Agent task artifact hover state on a task detail page.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ArtifactCard.tsx"
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
          "sceneId": "agent-task-running",
          "scenarioId": "agent-task-running",
          "scenario": "The current task is actively running, with the AI message active footer showing latest-action context and a same-surface stop affordance instead of a silent busy state.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
            "src/components/agent-tasks/ConversationInput.tsx",
            "src/components/agent-tasks/TaskHeader.tsx"
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
              "agent-task__task-header",
              "agent-tasks__message-active-run-footer",
              "agent-tasks__message-active-run-status",
              "agent-tasks__message-active-run-elapsed",
              "agent-tasks__message-active-run-latest-action",
              "agent-tasks__message-active-run-cancel",
              "agent-tasks__conversation-input"
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
          "sceneId": "agent-task-running-long-action-narrow",
          "scenarioId": "agent-task-running-long-action-narrow",
          "scenario": "The active AI message footer stays single-row on a narrower desktop viewport when the latest action is a long command, keeping the cancel affordance visible with its full accessible name.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
            "src/components/agent-tasks/MessageItem.tsx"
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
              "agent-task__task-header",
              "agent-tasks__message-active-run-footer",
              "agent-tasks__message-active-run-status",
              "agent-tasks__message-active-run-elapsed",
              "agent-tasks__message-active-run-latest-action",
              "agent-tasks__message-active-run-cancel",
              "agent-tasks__conversation-input"
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
          "sceneId": "agent-task-cancelling",
          "scenarioId": "agent-task-cancelling",
          "scenario": "The member already requested cancel, so the task clearly says stopping is in progress and holds the next turn until stop truth settles.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
            "src/components/agent-tasks/ConversationInput.tsx"
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
              "agent-task__task-header",
              "agent-tasks__message-active-run-footer",
              "agent-tasks__conversation-input",
              "agent-tasks__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__conversation-input"
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
          "sceneId": "agent-task-cancel-escalation-confirm",
          "scenarioId": "agent-task-cancel-escalation-confirm",
          "scenario": "Cancel has not settled in time, so the same task asks for an explicit force-stop confirmation before escalating the run.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/agent-tasks/TaskPage.tsx",
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
              "agent-task__task-header",
              "agent-tasks__cancel-escalation-dialog",
              "agent-tasks__cancel-escalation-cancel",
              "agent-tasks__cancel-escalation-confirm"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__cancel-escalation-dialog"
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
          "sceneId": "agent-task-terminating",
          "scenarioId": "agent-task-terminating",
          "scenario": "Cancel escalated to terminate, and the task makes the stronger stop state explicit before allowing any new run to begin.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
            "src/components/agent-tasks/ConversationInput.tsx"
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
              "agent-task__task-header",
              "agent-tasks__message-active-run-footer",
              "agent-tasks__conversation-input",
              "agent-tasks__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__conversation-input"
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
          "sceneId": "agent-task-finalizing",
          "scenarioId": "agent-task-finalizing",
          "scenario": "Execution already ended and the task is still saving the final answer and artifacts, so the member sees a real finishing state instead of a fake idle reset.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
            "src/components/agent-tasks/ConversationInput.tsx"
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
              "agent-task__task-header",
              "agent-tasks__message-active-run-footer",
              "agent-tasks__conversation-input",
              "agent-tasks__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__conversation-input"
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
          "sceneId": "agent-task-sse-reconnecting",
          "scenarioId": "agent-task-sse-reconnecting",
          "scenario": "The same task is still open while the live task stream reconnects, so the member can understand the temporary gap without losing the task surface.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
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
              "agent-task__task-header",
              "agent-tasks__message-active-run-footer",
              "agent-tasks__message-active-run-status",
              "agent-tasks__conversation-input",
              "agent-tasks__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__conversation-input"
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
          "sceneId": "agent-task-sse-unavailable-reconcile",
          "scenarioId": "agent-task-sse-unavailable-reconcile",
          "scenario": "Live updates cannot currently be trusted, so the task surfaces concise recovery guidance before the member blindly keeps going.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
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
              "agent-task__task-header",
              "agent-tasks__sse-status"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__execution-visibility"
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
          "sceneId": "agent-task-recovered-ready",
          "scenarioId": "agent-task-recovered-ready",
          "scenario": "After stop or reconnect truth settles, the same task returns to ready state so the member can continue without cloning a replacement task.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
            "src/components/agent-tasks/ConversationInput.tsx",
            "src/components/agent-tasks/TaskHeader.tsx"
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
              "agent-task__task-header",
              "agent-tasks__conversation-input",
              "agent-tasks__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__conversation-input"
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
          "sceneId": "agent-task-provider-upstream-error",
          "scenarioId": "agent-task-provider-upstream-error",
          "scenario": "The task stays recoverable after a provider failure by keeping the latest upstream guidance visible and leaving the same conversation ready for the next retry.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/ConversationPanel.tsx",
            "src/components/agent-tasks/MessageItem.tsx",
            "src/components/agent-tasks/message-item/utils.ts"
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
              "agent-task__task-header",
              "agent-tasks__agent-message-bubble",
              "agent-tasks__message-run-status",
              "agent-tasks__send-btn"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__conversation-input"
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
          "sceneId": "agent-task-hidden-terminal-blocked",
          "scenarioId": "agent-task-hidden-terminal-blocked",
          "scenario": "Hidden terminal sessions still occupy the same task, so the conversation surface stays fail-closed with reopen or end-session guidance instead of pretending the task is free.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/TaskHeader.tsx",
            "src/components/agent-tasks/terminal-session-summary.ts"
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
              "agent-task__task-header",
              "agent-tasks__task-terminal-status-strip",
              "agent-tasks__task-terminal-status-action",
              "agent-tasks__task-terminal-status-end-all"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__task-terminal-status-strip"
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
          "sceneId": "agent-task-terminal-truth-unavailable",
          "scenarioId": "agent-task-terminal-truth-unavailable",
          "scenario": "Backend terminal truth is temporarily unavailable, so the task stays fail-closed until the member retries terminal status from this same surface.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx",
            "src/components/agent-tasks/TaskPage.tsx",
            "src/components/agent-tasks/TaskHeader.tsx"
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
              "agent-task__task-header",
              "agent-tasks__task-terminal-truth-unavailable",
              "agent-tasks__task-terminal-truth-unavailable-retry"
            ],
            "prominentActionScopeTestIds": [
              "agent-tasks__task-terminal-truth-unavailable"
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
Mock lane agent task lifecycle visual scene family source.
