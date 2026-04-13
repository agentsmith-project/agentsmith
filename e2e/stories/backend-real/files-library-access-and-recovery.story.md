---
{
  "storyId": "files-library-access-and-recovery",
  "title": "Files library access and recovery",
  "actor": "workspace member / project operator",
  "family": "files-management",
  "personas": [
    "workspace member",
    "project operator"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/login/workspace",
  "goal": "成员在日常使用文件库时，既能顺畅进入 ready 文件库和桌面访问入口，也能在 degraded 文件库上看到清晰的恢复动作，而不是自己猜测下一步。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [
    {
      "dependencyId": "mongo-file-library-fixture",
      "kind": "service",
      "required": true,
      "note": "backend-real files story reads one ready library and inserts one degraded library fixture."
    }
  ],
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "filesLibraryAccessRecovery": {
      "degradedLibraryNamePrefix": "Story Files Recovery",
      "degradedLibraryDescription": "Temporary degraded fixture for the AI-native files recovery story."
    }
  },
  "narrative": "Files 的主故事不是只看列表，而是让成员在 ready 文件库里顺畅开始桌面访问，同时在 degraded 文件库里立刻看到可执行的恢复路径。",
  "scenes": [
    {
      "sceneId": "workspace-select",
      "route": "/en-US/login/workspace",
      "stableMarkers": [
        "workspace-select__list"
      ]
    },
    {
      "sceneId": "project-files",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__workspace-surface",
        "files__library-list"
      ]
    },
    {
      "sceneId": "desktop-access-dialog",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__dialog__desktop-mount-access"
      ]
    },
    {
      "sceneId": "degraded-delete-dialog",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__dialog__library-delete"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-files-library",
      "sceneId": "project-files",
      "intent": "Open the project files surface and enter a ready library.",
      "action": "Open files library",
      "target": "files__library-list",
      "expectedFeedback": "成员能看到 ready 文件库并进入文件工作面。",
      "note": "ready 文件库应该直接引导用户进入可用状态，而不是先处理错误信息。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "review-desktop-access",
      "sceneId": "desktop-access-dialog",
      "intent": "Review the desktop access guidance for a ready library.",
      "action": "Review desktop access",
      "target": "files__dialog__desktop-mount-access",
      "expectedFeedback": "桌面访问入口、下载引导和调试信息都清晰可见。",
      "note": "桌面接入是 files 的常用动作，应该在 ready 状态下顺滑可达。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "review-degraded-recovery",
      "sceneId": "degraded-delete-dialog",
      "intent": "Inspect the recovery guidance for a degraded library.",
      "action": "Review degraded recovery",
      "target": "files__dialog__library-delete",
      "expectedFeedback": "成员能看到 degraded 文件库不可用原因，以及删除坏记录后重建的恢复路径。",
      "note": "degraded 文件库的恢复文案要把下一步说清楚，而不是只暴露状态词。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for daily files library access and degraded recovery.
