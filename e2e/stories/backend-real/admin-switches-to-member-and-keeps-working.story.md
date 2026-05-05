---
{
  "storyId": "admin-switches-to-member-and-keeps-working",
  "title": "Admin switches to member and keeps working",
  "actor": "project admin / project owner",
  "family": "project-admin-switch-to-member",
  "personas": [
    "project admin",
    "project owner"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects",
  "goal": "项目管理员被降回普通成员后，自己还能继续做 agent-task 和 files 的真实工作，但治理入口要立即收缩，不允许旧的 admin surface 继续留在页面里。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is available",
    "Keycloak integration users are available",
    "backend-real endpoint credential is available"
  ],
  "externalDependencies": [
    {
      "dependencyId": "integration-keycloak-users",
      "kind": "integration",
      "required": true,
      "note": "backend-real admin-switch story needs integration Keycloak users to exercise real promotion and demotion."
    }
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "governanceRuntimeWork": {
      "projectNamePrefix": "Admin Switch Work",
      "memberEmail": "integration-member@example.com",
      "memberDisplayName": "Integration Member",
      "credentialNamePrefix": "Admin Switch Credential",
      "endpointNamePrefix": "Admin Switch Endpoint",
      "agentTaskRunnerTitlePrefix": "Admin Switch Agent Task Agent",
      "taskWorkspacePrefix": "Admin Switch Workspace",
      "agentTaskTitlePrefix": "Admin Switch Task",
      "agentTaskTokenPrefix": "ADMIN_SWITCH_AGENT_TASK",
      "artifactNamePrefix": "admin-switch-artifact"
    }
  },
  "narrative": "管理员最在意的不是自己某一刻是不是 admin，而是当治理能力被收回时，自己还能不能顺利继续原本的 agent-task 和 files 工作；治理面必须收缩，工作面必须继续，界面不能让人误以为自己还在拥有旧的 admin 特权。",
  "scenes": [
    {
      "sceneId": "project-settings",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/settings",
      "stableMarkers": [
        "settings__project-admins-section"
      ]
    },
    {
      "sceneId": "project-agent-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__artifact-card"
      ]
    },
    {
      "sceneId": "project-files",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__surface"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "confirm-admin-surface",
      "sceneId": "project-settings",
      "intent": "Open the project as an admin and confirm the governance surface is present before the role change.",
      "action": "Confirm admin surface",
      "target": "settings__project-admins-section",
      "expectedFeedback": "项目管理员能先看到自己的治理入口和成员管理能力，这样后续的降权才有可验证的基线。",
      "note": "先确认管理员确实处于能管理项目的状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "demote-admin-to-member",
      "sceneId": "project-settings",
      "intent": "Demote the current admin back to a member and save the lower access state.",
      "action": "Demote admin to member",
      "target": "settings__project-admins-save",
      "expectedFeedback": "管理员被降回成员后，治理入口应该被立即收回，不能继续保持旧的 admin surface。",
      "note": "角色切回 member 之后，治理面要同步收缩，而不是只改数据库。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "lose-governance-surface",
      "sceneId": "project-settings",
      "intent": "Reopen the settings surface and verify the former admin no longer has governance access.",
      "action": "Lose governance surface",
      "target": "settings__project-admins-section",
      "expectedFeedback": "管理员切回成员后，settings 页面应该直接收缩到 permission denied 或 read-only 结果，不再让人误以为还能继续管理项目。",
      "note": "这里是管理员自己最直观的权限变化感知点。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "continue-member-work",
      "sceneId": "project-agent-task",
      "intent": "Continue normal member work after the governance surface disappears.",
      "action": "Continue member work",
      "target": "agent-tasks__artifact-card",
      "expectedFeedback": "治理面收回后，agent-task 和 files 的日常工作仍然可用，成员应继续看到自己的任务产物和项目内容。",
      "note": "角色降级不应该打断 agent-task/files 正常工作流。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for admin switches to member and keeps working.
