---
{
  "storyId": "mock-lane-chat-operate-and-recover",
  "title": "Mock lane chat operate and recover scenes",
  "actor": "authenticated project member",
  "lane": "mock-lane",
  "family": "chat-operate-and-recover",
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/chat",
  "goal": "用一组 mock-lane story scenes 覆盖用户在 chat 中正常对话、切换执行目标，以及 stop / recover / retry 这些前后端状态同步必须说人话的高频心智。",
  "narrative": "Chat scenes cover the steady-state thread surface, the search-empty recovery path, and the inline stop / resync states a member relies on when a live reply needs to be interrupted, recovered, or retried without abandoning the current thread.",
  "preconditions": [
    "workspace ws_default and project proj_001 are available in the mock lane"
  ],
  "scenes": [
    {
      "sceneId": "chat-operate",
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
      "sceneId": "chat-recover-empty",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "chat__threads-empty-state",
        "chat__threads-empty-clear-search",
        "chat__new-thread-btn"
      ]
    },
    {
      "sceneId": "chat-streaming-active",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "chat__surface",
        "chat__header",
        "chat__stream-status",
        "chat__composer",
        "chat__stop-btn"
      ]
    },
    {
      "sceneId": "chat-stop-requested",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "chat__surface",
        "chat__header",
        "chat__stream-status",
        "chat__composer",
        "chat__stop-btn"
      ]
    },
    {
      "sceneId": "chat-stop-escalation-confirm",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": [
        "chat__surface",
        "chat__stop-escalation-dialog",
        "chat__stop-escalation-cancel",
        "chat__stop-escalation-confirm"
      ]
    },
    {
      "sceneId": "chat-stop-escalation-unavailable",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "chat__surface",
        "chat__header",
        "chat__stream-status",
        "chat__composer",
        "chat__stop-escalation-unavailable"
      ]
    },
    {
      "sceneId": "chat-recovering-live-session",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "chat__surface",
        "chat__header",
        "chat__stream-status",
        "chat__composer",
        "chat__stop-btn"
      ]
    },
    {
      "sceneId": "chat-provider-capacity-retry",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/chat",
      "recipeFamily": "work_surface_immersive",
      "authLane": "authed",
      "stableMarkers": [
        "chat__surface",
        "chat__header",
        "chat__stream-status",
        "chat__stream-error-recovery",
        "chat__stream-error-message",
        "chat__composer-recovery-endpoint--ep_2"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "chat-operate-open",
      "sceneId": "chat-operate",
      "intent": "Open an active chat thread and confirm the main composer loop is ready.",
      "action": "Open chat",
      "target": "chat__composer",
      "expectedFeedback": "Chat surface, thread list, and composer are ready for normal operation.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "chat-recover-empty-open",
      "sceneId": "chat-recover-empty",
      "intent": "Open the search-empty recovery state and start a new thread from the header CTA.",
      "action": "Recover chat",
      "target": "chat__new-thread-btn",
      "expectedFeedback": "The search-empty state stays informational, the body offers clear-search guidance, and the header keeps the new-thread recovery CTA.",
      "evidence": [
        "trace"
      ]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "chat-operate",
          "scenarioId": "chat-operate",
          "scenario": "Chat page with an active thread, thread list, and composer ready for regular work.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx",
            "src/components/chat/ChatMainPane.tsx",
            "src/components/chat/ChatHeader.tsx",
            "src/components/chat/ThreadsPane.tsx"
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
          ]
        },
        {
          "sceneId": "chat-recover-empty",
          "scenarioId": "chat-recover-empty",
          "scenario": "Chat recovery state with search results filtered to zero, an informational empty thread body, and the surviving header new-thread CTA.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx",
            "src/components/chat/ChatMainPane.tsx",
            "src/components/chat/ThreadsPane.tsx",
            "src/components/chat/threads-pane/ThreadsPaneHeader.tsx"
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
            "forbiddenVisibleText": [
              "Unknown",
              "Agent Unknown",
              "Unknown Runner"
            ],
            "requiredViewportTestIds": [
              "chat__new-thread-btn"
            ],
            "prominentActionScopeTestIds": [
              "chat__threads-empty-state"
            ],
            "maxProminentActions": 0
          }
        },
        {
          "sceneId": "chat-streaming-active",
          "scenarioId": "chat-streaming-active",
          "scenario": "A live reply is still streaming in the current thread, and the member can tell the thread is busy without losing the same chat context.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx",
            "src/components/chat/ChatMainPane.tsx",
            "src/components/chat/ChatHeader.tsx",
            "src/components/chat/Composer.tsx"
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
              "chat__surface",
              "chat__stream-status",
              "chat__composer",
              "chat__stop-btn"
            ],
            "prominentActionScopeTestIds": [
              "chat__composer"
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
          "sceneId": "chat-stop-requested",
          "scenarioId": "chat-stop-requested",
          "scenario": "The member already asked to stop the live reply, so the thread stays readable while new input is visibly held until backend stop truth settles.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx",
            "src/components/chat/ChatMainPane.tsx",
            "src/components/chat/ChatHeader.tsx",
            "src/components/chat/Composer.tsx",
            "src/lib/chat/composer-state.ts"
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
              "chat__surface",
              "chat__stream-status",
              "chat__composer",
              "chat__stop-btn"
            ],
            "prominentActionScopeTestIds": [
              "chat__composer"
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
          "sceneId": "chat-stop-escalation-confirm",
          "scenarioId": "chat-stop-escalation-confirm",
          "scenario": "Stop has not settled, and the member gets an explicit force-stop confirmation inside the same thread instead of hunting for a backend-only rescue path.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/chat/ChatHeader.tsx",
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
              "chat__surface",
              "chat__stop-escalation-dialog",
              "chat__stop-escalation-cancel",
              "chat__stop-escalation-confirm"
            ],
            "prominentActionScopeTestIds": [
              "chat__stop-escalation-dialog"
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
          "sceneId": "chat-stop-escalation-unavailable",
          "scenarioId": "chat-stop-escalation-unavailable",
          "scenario": "Forced stop is unavailable, so the chat stays in the same thread and returns the member to a readable inline status plus the same composer for an explicit next try.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx",
            "src/components/chat/ChatMainPane.tsx",
            "src/components/chat/ChatHeader.tsx",
            "src/components/chat/Composer.tsx",
            "src/lib/chat/use-chat-streaming.ts"
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
              "chat__surface",
              "chat__stream-status",
              "chat__composer",
              "chat__stop-escalation-unavailable"
            ],
            "prominentActionScopeTestIds": [
              "chat__header"
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
          "sceneId": "chat-recovering-live-session",
          "scenarioId": "chat-recovering-live-session",
          "scenario": "The member reopened a still-live thread while the session is recovering, and the header plus composer make it clear this is the same live conversation resyncing rather than a duplicate reply.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx",
            "src/components/chat/ChatMainPane.tsx",
            "src/components/chat/ChatHeader.tsx",
            "src/components/chat/Composer.tsx",
            "src/lib/chat/use-chat-streaming.ts"
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
              "chat__surface",
              "chat__stream-status",
              "chat__composer",
              "chat__stop-btn"
            ],
            "prominentActionScopeTestIds": [
              "chat__composer"
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
          "sceneId": "chat-provider-capacity-retry",
          "scenarioId": "chat-provider-capacity-retry",
          "scenario": "The provider is temporarily at capacity, but the thread stays intact and the member can recover from the same inline chat surface instead of abandoning the conversation.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx",
            "src/components/chat/ChatMainPane.tsx",
            "src/components/chat/ChatHeader.tsx",
            "src/components/chat/Composer.tsx",
            "src/lib/chat/use-chat-streaming.ts"
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
              "chat__surface",
              "chat__stream-status",
              "chat__composer",
              "chat__stream-error-recovery",
              "chat__stream-error-message",
              "chat__composer-recovery-endpoint--ep_2"
            ],
            "prominentActionScopeTestIds": [
              "chat__composer-recovery-shell"
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
Mock lane chat operate/recover visual scene family source.
