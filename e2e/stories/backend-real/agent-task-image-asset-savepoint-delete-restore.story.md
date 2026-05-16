---
{
  "storyId": "agent-task-image-asset-savepoint-delete-restore",
  "title": "Agent Task image asset save point delete restore",
  "actor": "project member",
  "family": "files-agent-task-recovery",
  "personas": [
    "project member",
    "project operator"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects/{projectId}/files",
  "goal": "项目成员让 Agent Task 在显式绑定的 ready 文件库中生成图片资产后，可以在 Files 里创建业务 save point、删除图片、说明文件和 manifest、再通过 restore 找回文件；回到同一个 Agent Task 后，成员还能从输入框继续发消息，managed runner 通过运行时 task metadata 证明仍在同一任务 HOME 中，读取恢复后的文件、manifest 和固定短文本，并写出新的 post-restore evidence；API 侧仍显示该任务绑定同一个 workspaceFileLibraryId。",
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
      "note": "backend-real image asset story needs a live Agent Task model endpoint to run the Python asset generation task."
    }
  ],
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible",
    "default project Agent Task runner and endpoint are ready"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "agentTaskImageAssetSavepoint": {
      "workspaceLibraryNamePrefix": "Image Asset Savepoint Library",
      "taskTitlePrefix": "Image asset savepoint task",
      "assetDirectory": "workspace/.artifacts",
      "artifactTokenPrefix": "AGENT_IMAGE_SAVEPOINT_RESTORE",
      "assetFiles": [
        "agent-image-{timestamp}.svg",
        "agent-image-notes-{timestamp}.md",
        "agent-image-manifest-{timestamp}.json",
        "post-restore-continue-{timestamp}.txt"
      ]
    }
  },
  "narrative": "这个故事覆盖成员真实工作闭环：Agent Task 负责生成可校验图片交付物，Files 负责保存、下载、save point、删除和恢复，restore 只影响文件库状态，不应该抹掉 Agent Task 已发生的对话与运行证据；restore 后用户回到同一个任务继续发消息时，runner 必须能重新读取恢复后的工作区文件并成功产出新证据。",
  "scenes": [
    {
      "sceneId": "agent-task-create",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks",
      "stableMarkers": [
        "agent-tasks__create-task-btn",
        "task-create__file-library"
      ]
    },
    {
      "sceneId": "agent-task-detail",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn",
        "agent-tasks__message-final-answer"
      ]
    },
    {
      "sceneId": "project-files",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__objects-table",
        "files__download",
        "files__file-states"
      ]
    },
    {
      "sceneId": "files-restore-confirm",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__restore-confirm",
        "files__restore-operation"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "bind-ready-library-to-agent-task",
      "sceneId": "agent-task-create",
      "intent": "Create a ready file library and explicitly bind it when creating the Agent Task.",
      "action": "Bind ready library",
      "target": "task-create__file-library",
      "expectedFeedback": "Agent Task header shows the selected workspace file library and the library is marked bound to that task.",
      "note": "这一步验证成员是在已有 ready 文件库上工作，而不是隐式创建未知文件库。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "generate-python-image-assets",
      "sceneId": "agent-task-detail",
      "intent": "Run a real Agent Task that uses Python stdlib to generate a deterministic SVG image, note, and manifest.",
      "action": "Generate image assets",
      "target": "agent-task__task-header",
      "expectedFeedback": "Agent Task run reaches a successful final state after the generated artifact is registered.",
      "note": "测试必须等待 run 终态成功，不能只因为看到 token 就开始 save point。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "download-and-verify-assets",
      "sceneId": "project-files",
      "intent": "Open Files, find the generated image assets, download them, and verify token, SVG structure, manifest markers, and explanation content.",
      "action": "Download generated assets",
      "target": "files__download",
      "expectedFeedback": "Files 中图片、说明和 manifest 可见可下载，内容与 Agent Task 生成结果一致。",
      "note": "图片资产不能只检查存在性，必须做内容级校验。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "create-business-save-point",
      "sceneId": "project-files",
      "intent": "Create a business save point before cleaning up generated image files.",
      "action": "Create save point",
      "target": "files__file-states",
      "expectedFeedback": "Save point list shows the business note for the asset cleanup point.",
      "note": "备注使用业务语义，便于后续恢复时理解为什么要回到这个状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "delete-image-note-and-manifest-from-files",
      "sceneId": "project-files",
      "intent": "Use Files UI multi-select to delete the generated image, note, and manifest from the same folder.",
      "action": "Delete selected files",
      "target": "files__delete",
      "expectedFeedback": "Selection summary reflects the selected files and the image, note, and manifest disappear from UI and backend entries.",
      "note": "删除路径代表用户心智，不用后台 API 绕过 Files UI。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "restore-save-point",
      "sceneId": "files-restore-confirm",
      "intent": "Restore the save point through Files UI and confirm the restore operation reaches a terminal state.",
      "action": "Restore save point",
      "target": "files__restore-confirm",
      "expectedFeedback": "Restore confirm appears before the request, restore operation settles, and deleted image, note, and manifest return with the expected file names, token, SVG marker, and note text.",
      "note": "restore 验证用户确认、终态和用户可理解的文件/文本结果。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-task-history-preserved",
      "sceneId": "agent-task-detail",
      "intent": "Confirm Files restore did not roll back or damage Agent Task conversation, trace, or task history.",
      "action": "Verify task history",
      "target": "agent-task__task-header",
      "expectedFeedback": "Agent Task 仍显示原任务，runner output token 和 trace evidence 仍可通过 API 读取。",
      "note": "文件库 restore 只恢复文件状态，不应该抹掉任务历史。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "continue-same-task-after-restore",
      "sceneId": "agent-task-detail",
      "intent": "Return to the same Agent Task page and send a follow-up message from the UI input after Files restore.",
      "action": "Send follow-up message",
      "target": "agent-tasks__conversation-input",
      "expectedFeedback": "The follow-up run starts from the same task, records runner-observed task metadata, reads the restored image, note, manifest, and fixed markers, writes post-restore-continue evidence in .artifacts, the API task binding still points to the same workspaceFileLibraryId, and the run finishes with successful runner output and final answer.",
      "note": "这一步覆盖真实用户心智：用户不是只检查历史，而是回到原任务继续工作；不能只断言历史存在，必须断言第二次 managed runner 成功执行。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for Agent Task generated image assets flowing through Files save point delete restore and continuing successfully in the same task afterward.
