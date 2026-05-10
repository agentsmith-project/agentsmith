---
{
  "storyId": "files-crud-and-sync",
  "title": "Files CRUD and sync continuity",
  "actor": "project member / project operator",
  "family": "files-daily-work",
  "personas": [
    "project member",
    "project operator"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects/{projectId}/files",
  "goal": "成员在 Files 中管理文件对象后，Web 文件浏览、API 响应和 task HOME 展示状态保持同一产品真相，不需要自己猜测哪一侧才可信。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [],
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "filesCrudSync": {
      "webCrud": {
        "projectNamePrefix": "Story Files CRUD",
        "libraryNamePrefix": "Story Files CRUD",
        "folderNamePrefix": "story-docs",
        "uploadFileName": "story-web-note.txt",
        "uploadContent": "story-web-content\\n",
        "renamedFileName": "story-web-note-renamed.txt"
      }
    }
  },
  "narrative": "Files 的高频主故事不是孤立的 API 行为，而是成员在浏览器里管理文件对象后，能通过 Web/API 看到同一份结果，并理解 task HOME 绑定状态不会暴露原始存储字段。",
  "scenes": [
    {
      "sceneId": "project-files",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__workspace-surface",
        "files__library-list"
      ]
    },
    {
      "sceneId": "project-files-browser",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__objects-table"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-files-library",
      "sceneId": "project-files",
      "intent": "Open a ready files library from the project files surface.",
      "action": "Open files library",
      "target": "files__library-list",
      "expectedFeedback": "成员可以进入准备就绪的文件库。",
      "note": "Files 主入口应该先把人带到可用文件库，而不是让用户自己拼状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "manage-files-from-web",
      "sceneId": "project-files-browser",
      "intent": "Create folders, upload files, rename items, inspect details, and delete from the web object browser.",
      "action": "Manage files from web",
      "target": "files__objects-table",
      "expectedFeedback": "浏览器侧的文件 CRUD 流程可顺畅完成。",
      "note": "浏览器侧 CRUD 应保持连续工作流，而不是拆成一串无上下文弹窗。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for high-frequency Files CRUD and Web/API continuity.
