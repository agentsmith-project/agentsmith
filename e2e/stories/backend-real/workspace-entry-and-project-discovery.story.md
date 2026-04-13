---
{
  "storyId": "workspace-entry-and-project-discovery",
  "title": "Workspace entry and project discovery",
  "actor": "workspace admin / project creator",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/login",
  "goal": "workspace admin can enter the workspace and discover the project list without denied flicker.",
  "preconditions": [
    "backend-real stack is ready",
    "ws_default is published",
    "Keycloak is configured"
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
  "narrative": "workspace entry should land directly in the projects discovery surface so users can understand where project creation and existing projects live.",
  "scenes": [
    {
      "sceneId": "workspace-login",
      "route": "/en-US/workspaces/ws_default/login",
      "stableMarkers": [
        "workspace-login__keycloak-btn"
      ]
    },
    {
      "sceneId": "workspace-projects",
      "route": "/en-US/workspaces/ws_default/projects",
      "stableMarkers": [
        "projects__page",
        "projects__create-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "workspace-login",
      "sceneId": "workspace-login",
      "intent": "Open workspace login.",
      "action": "Open workspace login",
      "target": "workspace-login__keycloak-btn",
      "expectedFeedback": "工作区登录入口",
      "note": "工作区登录入口",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-projects",
      "sceneId": "workspace-projects",
      "intent": "Enter workspace projects.",
      "action": "Enter workspace projects",
      "target": "projects__create-btn",
      "expectedFeedback": "workspace admin 进入项目列表",
      "note": "workspace admin 进入项目列表",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "project-discovery",
      "sceneId": "workspace-projects",
      "intent": "Discover the project list and creation entry.",
      "action": "Discover project list",
      "target": "projects__create-btn",
      "expectedFeedback": "项目列表与创建入口稳定可见",
      "note": "项目列表与创建入口稳定可见",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "workspace-entry-and-project-discovery",
  "personas": [
    "workspace admin",
    "project creator"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for workspace entry and project discovery.
