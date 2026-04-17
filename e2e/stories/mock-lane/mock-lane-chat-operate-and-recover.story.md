---
{
  "storyId": "mock-lane-chat-operate-and-recover",
  "title": "Mock lane chat operate and recover scenes",
  "actor": "authenticated project member",
  "lane": "mock-lane",
  "family": "chat-operate-and-recover",
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/chat",
  "goal": "用一组 mock-lane story scenes 覆盖用户在 chat 中正常对话、切换执行目标，以及在搜索为空时恢复新线程的高频心智。",
  "narrative": "Chat scenes cover the active conversation surface and the search-empty recovery path a member uses when they need to restart a thread.",
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
          "setupNotes": [
            "viewport:1440x900"
          ],
          "themes": [
            "light",
            "dark"
          ],
          "semanticAssertions": {
            "requiredViewportTestIds": [
              "chat__new-thread-btn"
            ],
            "prominentActionScopeTestIds": [
              "chat__threads-empty-state"
            ],
            "maxProminentActions": 0
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
