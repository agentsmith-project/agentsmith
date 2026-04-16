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
    "sandbox manager is ready"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "notebook": {
      "external_create": {
        "turnOne": {
          "prompt": "Create notes/external_story.txt with exactly one line: external turn 1. Then reply with exactly EXT_T1_OK.",
          "expectedToken": "EXT_T1_OK",
          "expectedArtifactPath": ".artifacts/external_summary.md"
        },
        "turnTwo": {
          "prompt": "Read notes/external_story.txt, append a second line external turn 2, create .artifacts/external_summary.md summarizing the file, then reply with exactly EXT_T2_OK.",
          "expectedToken": "EXT_T2_OK",
          "expectedArtifactPath": ".artifacts/external_summary.md"
        }
      },
      "external_reuse": {
        "turnOne": {
          "prompt": "Read notes/external_story.txt and reply with exactly EXT_REUSE_T1_OK if it still contains both lines.",
          "expectedToken": "EXT_REUSE_T1_OK",
          "expectedArtifactPath": ".artifacts/external_reuse.md"
        },
        "turnTwo": {
          "prompt": "Create .artifacts/external_reuse.md that says the reused workspace is intact, then reply with exactly EXT_REUSE_T2_OK.",
          "expectedToken": "EXT_REUSE_T2_OK",
          "expectedArtifactPath": ".artifacts/external_reuse.md"
        }
      },
      "internal": {
        "turnOne": {
          "prompt": "Run the following shell command exactly, then reply with exactly INT_T1_OK. ```bash mkdir -p notes && cat <<'EOF' > notes/internal_story.txt internal turn 1 EOF ```",
          "expectedToken": "INT_T1_OK",
          "expectedArtifactPath": ".artifacts/internal_summary.md"
        },
        "turnTwo": {
          "prompt": "Run the following shell commands exactly, then reply with exactly INT_T2_OK. ```bash if [ ! -f notes/internal_story.txt ]; then echo 'missing-internal-story' >&2; exit 1; fi printf '\\ninternal turn 2\\n' >> notes/internal_story.txt mkdir -p .artifacts cat <<'EOF' > .artifacts/internal_summary.md # Internal Story Summary internal turn 1 internal turn 2 EOF ```",
          "expectedToken": "INT_T2_OK",
          "expectedArtifactPath": ".artifacts/internal_summary.md"
        }
      }
    }
  },
  "narrative": "系统、工作区、项目、Notebook、Files 和 Usage 的真实发布主链，需要由一份稳定 story contract 统一描述 trace 行为与验收证据。",
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
        "project-overview__heading"
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
      "sceneId": "project-agents",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agents",
      "stableMarkers": [
        "agents__heading"
      ]
    },
    {
      "sceneId": "project-notebook",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook",
      "stableMarkers": [
        "notebook__task-header"
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
      "target": "project-overview__heading",
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
      "stepId": "agents-list-external",
      "sceneId": "project-agents",
      "intent": "Inspect the external agent list.",
      "action": "Review agents",
      "target": "agents__heading",
      "expectedFeedback": "外部 agent 已创建",
      "note": "外部 agent 已创建",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agents-list-internal",
      "sceneId": "project-agents",
      "intent": "Inspect the internal agent list.",
      "action": "Review internal agent",
      "target": "agents__heading",
      "expectedFeedback": "内部 agent 已创建",
      "note": "内部 agent 已创建",
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
      "stepId": "notebook-task-external-1",
      "sceneId": "project-notebook",
      "intent": "Create the first external notebook task.",
      "action": "Create external notebook task",
      "target": "notebook__task-header",
      "expectedFeedback": "external task A 创建成功",
      "note": "external task A 创建成功",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "files-artifacts-external",
      "sceneId": "project-files",
      "intent": "Inspect external task artifacts in Files.",
      "action": "Inspect generated artifacts",
      "target": "files__objects-table",
      "expectedFeedback": "external task 的 .artifacts 已可见",
      "note": "external task 的 .artifacts 已可见",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "notebook-task-detail-external",
      "sceneId": "project-notebook",
      "intent": "Inspect the external task detail view.",
      "action": "Review task detail",
      "target": "notebook__task-header",
      "expectedFeedback": "external task 详情页",
      "note": "external task 详情页",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "notebook-task-detail-external-reuse",
      "sceneId": "project-notebook",
      "intent": "Inspect the reused workspace task.",
      "action": "Review reused workspace task",
      "target": "notebook__task-header",
      "expectedFeedback": "external task B 复用 workspace 成功",
      "note": "external task B 复用 workspace 成功",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "files-artifacts-internal",
      "sceneId": "project-files",
      "intent": "Inspect internal task artifacts in Files.",
      "action": "Inspect internal artifacts",
      "target": "files__objects-table",
      "expectedFeedback": "internal task 的 .artifacts 已可见",
      "note": "internal task 的 .artifacts 已可见",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "usage-overview",
      "sceneId": "project-usage",
      "intent": "Inspect usage after notebook activity.",
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
