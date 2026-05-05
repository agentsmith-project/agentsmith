---
{
  "storyId": "agent-task-first-success",
  "title": "First agent-task success",
  "actor": "system 管理侧 / workspace admin / project member",
  "family": "agent-task-first-success",
  "personas": [
    "system 管理侧",
    "workspace admin",
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/system/login",
  "goal": "新工作区准备完成后，workspace admin 应先把 agent-task 配到可用，再让成员第一次进入 agent-task 就能成功创建任务并拿到第一条有效结果，而不是停在配置或运行失败上。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [
    {
      "dependencyId": "provider-api-key",
      "kind": "credential",
      "required": true,
      "note": "backend-real agent-task onboarding story needs a runnable endpoint credential."
    }
  ],
  "preconditions": [
    "backend-real stack is ready",
    "system 管理侧与集成用户账户可用"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "agentTaskFirstSuccess": {
      "workspaceNamePrefix": "Story Agent Task First Success",
      "adminEmail": "dev-admin@example.com",
      "projectNamePrefix": "Story Agent Task Delivery",
      "agentNamePrefix": "Story Agent Task Agent",
      "taskTitlePrefix": "Story First Agent Task Task",
      "taskWorkspaceNamePrefix": "Story Agent Task Workspace",
      "expectedTokenPrefix": "STORY_AGENT_TASK_OK"
    }
  },
  "narrative": "Agent Task 的首次成功故事不是 runner 细节，而是从 system 发布、workspace admin 完成最小项目配置，到成员第一次真正跑通 Agent Task 任务并看到结果的连续体验。",
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
        "system-workspaces__new-workspace"
      ]
    },
    {
      "sceneId": "project-agent-runners",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-runners",
      "stableMarkers": [
        "agent-runners__create-btn"
      ]
    },
    {
      "sceneId": "project-members",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/members",
      "stableMarkers": [
        "members__search-input"
      ]
    },
    {
      "sceneId": "project-agent-tasks",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks",
      "stableMarkers": [
        "agent-tasks__task-list",
        "agent-tasks__create-task-btn"
      ]
    },
    {
      "sceneId": "agent-task-detail",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__conversation-input"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-system-login",
      "sceneId": "system-login",
      "intent": "Open the system administration entry point that starts the agent-task onboarding chain.",
      "action": "Open system login",
      "target": "system-login__heading",
      "expectedFeedback": "system 管理侧入口可用，能开始创建工作区。",
      "note": "第一次 Agent Task 成功依然建立在清晰可达的 system 管理入口之上。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "publish-workspace",
      "sceneId": "system-workspaces",
      "intent": "Create and publish the workspace that will host the member's first agent-task use.",
      "action": "Publish workspace",
      "target": "system-workspaces__new-workspace",
      "expectedFeedback": "新工作区发布完成，可供 workspace admin 和项目成员使用。",
      "note": "首次成功的前提是工作区真的变成可访问状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "configure-agent-task-project",
      "sceneId": "project-agent-runners",
      "intent": "Prepare the project so agent-task can be used successfully on the first try.",
      "action": "Configure Agent Task project",
      "target": "agent-runners__create-btn",
      "expectedFeedback": "project creator 已完成 agent-task 所需的最小配置。",
      "note": "成员第一次进入 agent-task 之前，项目应已经具备可用配置。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "grant-member-agent-task-access",
      "sceneId": "project-members",
      "intent": "Grant the new member the project access needed to start agent-task work.",
      "action": "Grant member Agent Task access",
      "target": "members__search-input",
      "expectedFeedback": "成员已经具备进入项目并开始 Agent Task 使用的访问权限。",
      "note": "第一次成功不能靠隐式权限；成员必须真实获得项目访问。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "run-first-agent-task",
      "sceneId": "agent-task-detail",
      "intent": "Run the member's first Agent Task and see a successful answer.",
      "action": "Run first Agent Task",
      "target": "agent-tasks__conversation-input",
      "expectedFeedback": "成员成功创建任务并拿到第一条 Agent Task 结果。",
      "note": "首次成功的定义是任务真的跑通并返回结果，不是只看到创建弹窗。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for first successful agent-task use.
