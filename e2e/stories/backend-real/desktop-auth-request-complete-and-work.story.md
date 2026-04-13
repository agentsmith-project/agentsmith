---
{
  "storyId": "desktop-auth-request-complete-and-work",
  "title": "Desktop auth request, complete, and continue to work",
  "actor": "workspace member / desktop user",
  "lane": "backend-real",
  "entryRoute": "/en-US/desktop/auth/request?desktop_auth_request_id={desktopAuthRequestId}",
  "goal": "桌面端发起的请求在浏览器里完成后，用户应该能清楚地回到工作区入口并继续开始工作，而不是把 Desktop 交接当成终点。",
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is published",
    "Keycloak is configured",
    "desktop auth start endpoint is available"
  ],
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "seedData": [
    "ws_default"
  ],
  "externalDependencies": [],
  "narrative": "Desktop auth should read like a short handoff: finish the browser request, confirm the completion page, and then return to workspace entry so work can continue immediately.",
  "scenes": [
    {
      "sceneId": "desktop-auth-request",
      "route": "/en-US/desktop/auth/request?desktop_auth_request_id={desktopAuthRequestId}",
      "stableMarkers": [
        "desktop-auth-request__title",
        "desktop-auth-request__request-id"
      ]
    },
    {
      "sceneId": "desktop-auth-complete",
      "route": "/en-US/desktop/auth/complete?desktop_auth_request_id={desktopAuthRequestId}",
      "stableMarkers": [
        "desktop-auth-complete__title",
        "desktop-auth-complete__workspace-entry-link"
      ]
    },
    {
      "sceneId": "workspace-selection",
      "route": "/en-US/login/workspace",
      "stableMarkers": [
        "workspace-select__list"
      ]
    },
    {
      "sceneId": "workspace-login",
      "route": "/en-US/workspaces/{workspaceId}/login",
      "stableMarkers": [
        "workspace-login__keycloak-btn"
      ]
    },
    {
      "sceneId": "workspace-entry",
      "route": "/en-US/workspaces/{workspaceId}",
      "stableMarkers": [
        "projects__page"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "desktop-auth-request",
      "sceneId": "desktop-auth-request",
      "intent": "Open the browser handoff request and keep the Desktop flow active.",
      "action": "Review desktop request",
      "target": "desktop-auth-request__title",
      "expectedFeedback": "用户先看到这是一条 Desktop 交接请求，而不是普通页面错误。",
      "note": "Desktop request 本身就应该把继续工作的意图说清楚。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "desktop-auth-complete",
      "sceneId": "desktop-auth-complete",
      "intent": "Confirm that the browser completed the Desktop request and offers a way back to workspace entry.",
      "action": "Review desktop completion",
      "target": "desktop-auth-complete__workspace-entry-link",
      "expectedFeedback": "完成页清楚告诉用户可以回到工作区入口继续工作。",
      "note": "完成页不是终点，它只是把浏览器会话交回去。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-selection",
      "sceneId": "workspace-selection",
      "intent": "Return to workspace selection and make the next step obvious before the user signs in again.",
      "action": "Continue to workspace sign-in",
      "target": "workspace-select__list",
      "expectedFeedback": "用户能重新看到工作区入口，并明确下一步是选择 workspace。",
      "note": "Desktop 交接后的下一步应该回到 workspace selection，而不是把用户直接丢到一个抽象完成页。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-login",
      "sceneId": "workspace-login",
      "intent": "Open the selected workspace sign-in page and show the user the next login step clearly.",
      "action": "Continue workspace sign-in",
      "target": "workspace-login__keycloak-btn",
      "expectedFeedback": "用户看到这个 workspace 的登录入口，并知道接下来要完成 workspace sign-in。",
      "note": "desktop-auth 的完成页不应该把 signin 与 entry 混成一个步骤。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-entry",
      "sceneId": "workspace-entry",
      "intent": "Confirm the chosen workspace can still be entered after the Desktop handoff and the workspace sign-in step.",
      "action": "Continue to workspace entry",
      "target": "projects__page",
      "expectedFeedback": "用户能继续进入 workspace，并看到项目入口页面，说明 Desktop 交接没有把工作流切断。",
      "note": "完成页之后应该能重新进入 workspace 项目入口，而不是停在抽象的 overview 标题上。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "desktop-auth-request-complete-and-work",
  "personas": [
    "workspace member",
    "desktop user"
  ],
  "kind": "journey"
}
---
Canonical backend-real story for Desktop auth request completion and workspace continuation.
