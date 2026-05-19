---
{
  "storyId": "release-user-story-end-to-end",
  "title": "Release user story end-to-end",
  "actor": "system 管理侧 / workspace admin / project owner / member",
  "lane": "backend-real",
  "entryRoute": "/en-US/system/login",
  "goal": "用真实 backend 走完发布关键用户故事，并把关键 UI 状态写成 trace bundle。",
  "preconditions": [
    "backend-real stack is ready",
    "Keycloak and provider API key are configured",
    "task execution environment is ready"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "agentTask": {
      "managed_create": {
        "turnOne": {
          "prompt": "Create notes/managed_story.txt with exactly one line: managed turn 1. Then reply with exactly MANAGED_T1_OK.",
          "expectedToken": "MANAGED_T1_OK",
          "expectedArtifactPath": ".artifacts/managed_summary.md"
        },
        "turnTwo": {
          "prompt": "Read notes/managed_story.txt, append a second line managed turn 2, create .artifacts/managed_summary.md summarizing the file, then reply with exactly MANAGED_T2_OK.",
          "expectedToken": "MANAGED_T2_OK",
          "expectedArtifactPath": ".artifacts/managed_summary.md"
        }
      },
      "managed_reuse": {
        "turnOne": {
          "prompt": "Read notes/managed_story.txt and reply with exactly MANAGED_REUSE_T1_OK if it still contains both lines.",
          "expectedToken": "MANAGED_REUSE_T1_OK",
          "expectedArtifactPath": ".artifacts/managed_reuse.md"
        },
        "turnTwo": {
          "prompt": "Create .artifacts/managed_reuse.md that says the reused workspace is intact, then reply with exactly MANAGED_REUSE_T2_OK.",
          "expectedToken": "MANAGED_REUSE_T2_OK",
          "expectedArtifactPath": ".artifacts/managed_reuse.md"
        }
      },
      "managed_continuity": {
        "turnOne": {
          "prompt": "Run the following shell command exactly, then reply with exactly MANAGED_CONT_T1_OK. ```bash mkdir -p notes && cat <<'EOF' > notes/managed_continuity.txt managed continuity turn 1 EOF ```",
          "expectedToken": "MANAGED_CONT_T1_OK",
          "expectedArtifactPath": ".artifacts/managed_continuity.md"
        },
        "turnTwo": {
          "prompt": "Run the following shell commands exactly, then reply with exactly MANAGED_CONT_T2_OK. ```bash if [ ! -f notes/managed_continuity.txt ]; then echo 'missing-managed-continuity' >&2; exit 1; fi printf '\\nmanaged continuity turn 2\\n' >> notes/managed_continuity.txt mkdir -p .artifacts cat <<'EOF' > .artifacts/managed_continuity.md # Managed Continuity Summary managed continuity turn 1 managed continuity turn 2 EOF ```",
          "expectedToken": "MANAGED_CONT_T2_OK",
          "expectedArtifactPath": ".artifacts/managed_continuity.md"
        }
      }
    }
  },
  "narrative": "系统、工作区、项目、Agent Task、Files 和 Usage 的真实发布主链，需要由一份稳定 story contract 统一描述 trace 行为与验收证据。",
  "scenes": [
    {
      "sceneId": "system-login",
      "route": "/en-US/system/login",
      "stableMarkers": [
        "system-login__heading"
      ]
    },
    {
      "sceneId": "system-workspaces",
      "route": "/en-US/system/workspaces",
      "stableMarkers": [
        "system-workspaces__list",
        "system-workspaces__new-workspace"
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
      "sceneId": "workspace-projects",
      "route": "/en-US/workspaces/{workspaceId}/projects",
      "stableMarkers": [
        "projects__heading"
      ]
    },
    {
      "sceneId": "project-overview",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/overview",
      "stableMarkers": [
        "project-overview__page"
      ]
    },
    {
      "sceneId": "project-members",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/members",
      "stableMarkers": [
        "members__requests-tab",
        "members__people-tab"
      ]
    },
    {
      "sceneId": "project-credentials",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/credentials",
      "stableMarkers": [
        "credentials__heading"
      ]
    },
    {
      "sceneId": "project-endpoints",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/endpoints",
      "stableMarkers": [
        "endpoints__heading"
      ]
    },
    {
      "sceneId": "project-resource-policy",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/resource-policy",
      "stableMarkers": [
        "resource-policy__table"
      ]
    },
    {
      "sceneId": "project-agent-runners",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-runners",
      "stableMarkers": [
        "agent-runners__project-default-status",
        "agent-runners__system-managed-section",
        "agent-runners__system-managed-table"
      ]
    },
    {
      "sceneId": "project-agent-tasks",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
      "stableMarkers": [
        "agent-task__task-header"
      ]
    },
    {
      "sceneId": "project-files",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__objects-table"
      ]
    },
    {
      "sceneId": "project-usage",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/usage",
      "stableMarkers": [
        "usage__view"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "system-login",
      "sceneId": "system-login",
      "intent": "Open the system login entry.",
      "action": "Open system login",
      "target": "system-login__heading",
      "expectedFeedback": "system 管理侧登录入口",
      "note": "system 管理侧登录入口",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "system-workspaces",
      "sceneId": "system-workspaces",
      "intent": "Review the system workspace index.",
      "action": "Review system workspaces",
      "target": "system-workspaces__list",
      "expectedFeedback": "工作区清单与创建入口",
      "note": "工作区清单与创建入口",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "system-workspace-published",
      "sceneId": "system-workspaces",
      "intent": "Create and publish a workspace.",
      "action": "Create and publish workspace",
      "target": "system-workspaces__new-workspace",
      "expectedFeedback": "新工作区创建并发布完成",
      "note": "新工作区创建并发布完成",
      "evidence": [
        "trace"
      ]
    },
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
      "intent": "Enter workspace projects as admin.",
      "action": "Enter workspace projects",
      "target": "projects__heading",
      "expectedFeedback": "workspace admin 进入项目列表",
      "note": "workspace admin 进入项目列表",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "project-overview",
      "sceneId": "project-overview",
      "intent": "Open the new project overview.",
      "action": "Open project overview",
      "target": "project-overview__page",
      "expectedFeedback": "项目创建成功后的 overview",
      "note": "项目创建成功后的 overview",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "projects-list-member",
      "sceneId": "workspace-projects",
      "intent": "Review projects as a member.",
      "action": "Review projects as member",
      "target": "projects__heading",
      "expectedFeedback": "普通成员查看项目列表",
      "note": "普通成员查看项目列表",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "join-request-pending",
      "sceneId": "workspace-projects",
      "intent": "Request access to the project.",
      "action": "Request project access",
      "target": "projects__join-request-btn",
      "targetMatch": "prefix",
      "expectedFeedback": "普通成员发起加入申请后的待审批状态",
      "note": "普通成员发起加入申请后的待审批状态",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "join-request-review",
      "sceneId": "project-members",
      "intent": "Review the pending join request.",
      "action": "Review join request",
      "target": "members__requests-tab",
      "expectedFeedback": "项目所有者查看待审批加入申请",
      "note": "项目所有者查看待审批加入申请",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "join-request-approved",
      "sceneId": "project-members",
      "intent": "Approve the join request.",
      "action": "Approve join request",
      "target": "members__people-tab",
      "expectedFeedback": "加入申请已批准并授予项目访问",
      "note": "加入申请已批准并授予项目访问",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "credentials-list",
      "sceneId": "project-credentials",
      "intent": "Inspect project credentials.",
      "action": "Review credentials",
      "target": "credentials__heading",
      "expectedFeedback": "项目凭据列表",
      "note": "项目凭据列表",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "endpoints-list",
      "sceneId": "project-endpoints",
      "intent": "Inspect project endpoints.",
      "action": "Review endpoints",
      "target": "endpoints__heading",
      "expectedFeedback": "双 preset endpoint 列表",
      "note": "双 preset endpoint 列表",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "resource-policy",
      "sceneId": "project-resource-policy",
      "intent": "Inspect resource policy.",
      "action": "Review resource policy",
      "target": "resource-policy__table",
      "expectedFeedback": "双 endpoint 的资源策略已就绪",
      "note": "双 endpoint 的资源策略已就绪",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agent-runners-managed-list",
      "sceneId": "project-agent-runners",
      "intent": "Inspect the managed Agent Runner list.",
      "action": "Review Agent Runners",
      "target": "agent-runners__system-managed-table",
      "expectedFeedback": "托管 Agent Runner 已创建",
      "note": "托管 Agent Runner 已创建",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agent-runners-managed-health",
      "sceneId": "project-agent-runners",
      "intent": "Inspect the managed Agent Runner list.",
      "action": "Review managed Agent Runner",
      "target": "agent-runners__project-default-status",
      "expectedFeedback": "托管 Agent Runner 的健康状态可见",
      "note": "托管 Agent Runner 的健康状态可见",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "member-workspace-home",
      "sceneId": "workspace-projects",
      "intent": "Return to workspace as a member.",
      "action": "Return as member",
      "target": "projects__heading",
      "expectedFeedback": "成员重新进入 workspace",
      "note": "成员重新进入 workspace",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agent-task-managed-1",
      "sceneId": "project-agent-tasks",
      "intent": "Create the first managed Agent Task.",
      "action": "Create managed Agent Task",
      "target": "agent-task__task-header",
      "expectedFeedback": "managed Agent Task A 创建成功",
      "note": "managed Agent Task A 创建成功",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "files-artifacts-managed",
      "sceneId": "project-files",
      "intent": "Inspect managed Agent Task artifacts in Files under the task workspace directory.",
      "action": "Inspect generated artifacts",
      "target": "files__objects-table",
      "expectedFeedback": "managed Agent Task 的 workspace/.artifacts 已可见",
      "note": "managed Agent Task 的 workspace/.artifacts 已可见",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agent-task-detail-managed",
      "sceneId": "project-agent-tasks",
      "intent": "Inspect the managed Agent Task detail view.",
      "action": "Review task detail",
      "target": "agent-task__task-header",
      "expectedFeedback": "managed Agent Task 详情页",
      "note": "managed Agent Task 详情页",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agent-task-detail-managed-reuse",
      "sceneId": "project-agent-tasks",
      "intent": "Inspect the reused workspace task.",
      "action": "Review reused workspace task",
      "target": "agent-task__task-header",
      "expectedFeedback": "managed Agent Task B 复用 workspace 成功",
      "note": "managed Agent Task B 复用 workspace 成功",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "managed-continuity-governance-config",
      "sceneId": "project-agent-runners",
      "intent": "Switch to the project owner identity and configure the managed runner/model setting for the secondary endpoint.",
      "action": "Configure managed continuity runner",
      "target": "agent-runners__project-default-status",
      "expectedFeedback": "项目所有者执行治理配置：切换到 secondary endpoint 的托管 Agent Runner",
      "note": "项目所有者执行治理配置：切换到 secondary endpoint 的托管 Agent Runner",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "member-workspace-home-after-governance-config",
      "sceneId": "workspace-projects",
      "intent": "Return to the workspace as the ordinary member before running the managed continuity task.",
      "action": "Return as member after managed runner config",
      "target": "projects__heading",
      "expectedFeedback": "普通成员重新进入 workspace，继续使用托管 Agent Runner",
      "note": "普通成员重新进入 workspace，继续使用托管 Agent Runner",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "files-artifacts-managed-continuity",
      "sceneId": "project-files",
      "intent": "Inspect managed Agent Task artifacts in Files under the task workspace directory.",
      "action": "Inspect managed continuity artifacts",
      "target": "files__objects-table",
      "expectedFeedback": "managed Agent Task 的 workspace/.artifacts 已可见",
      "note": "managed Agent Task 的 workspace/.artifacts 已可见",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "usage-overview",
      "sceneId": "project-usage",
      "intent": "Inspect usage after agent-task activity.",
      "action": "Review usage metrics",
      "target": "usage__view",
      "expectedFeedback": "usage 页面已验证 endpoint 请求数据",
      "note": "usage 页面已验证 endpoint 请求数据",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "release-user-story-end-to-end",
  "personas": [
    "system 管理侧",
    "workspace admin",
    "project owner",
    "member"
  ],
  "kind": "journey",
  "gatePolicy": {
    "tier": "release",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": []
}
---
Canonical release story source.
