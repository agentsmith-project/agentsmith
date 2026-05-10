---
{
  "storyId": "unicode-filename-round-trip",
  "title": "Unicode filename round-trip across Files, agent-task artifacts, and download",
  "actor": "project member",
  "family": "unicode-file-continuity",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
  "goal": "成员使用非 ASCII 文件名工作时，Files、Agent Task、.artifacts 和下载结果都必须保留同一份文件名真相；用户不应该为了避开系统差异，被迫把真实文件重命名成英文占位符。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible",
    "Keycloak integration users are available"
  ],
  "seedData": [
    "ws_default"
  ],
  "externalDependencies": [
    {
      "dependencyId": "provider-api-key",
      "kind": "credential",
      "required": true,
      "note": "agent-task artifact generation in the unicode round-trip story needs a runnable AI path."
    }
  ],
  "runtimeData": {
    "unicodeFilenameRoundTrip": {
      "sourceFileName": "设计评审-uberblick-東京.txt",
      "artifactFileName": "交付总结-uberblick-東京.md"
    }
  },
  "narrative": "文件名 round-trip 的主故事不是编码细节，而是成员真实面对的文件对象保持同一个名字。用户在 Files 里看到的 Unicode 名称，到了 Agent Task、.artifacts 和下载文件里，都应该还是同一个名字；如果系统在任何一段把它偷偷改写、转义或丢字，用户面对的就不再是同一份工作成果。",
  "scenes": [
    {
      "sceneId": "project-files",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__workspace-surface",
        "files__library-list",
        "files__objects-table",
        "files__download"
      ]
    },
    {
      "sceneId": "agent-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "see-the-unicode-file-name-in-files-without-fallback-renaming",
      "sceneId": "project-files",
      "intent": "Recognize the original Unicode filename directly in Files.",
      "action": "Open Files and review the Unicode-named file",
      "target": "files__objects-table",
      "expectedFeedback": "成员在 Files 中看到真实的 Unicode 文件名，而不是被平台偷偷改成 ASCII 占位名。",
      "note": "文件真相首先必须在主文件浏览面里成立。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "use-the-unicode-file-in-agent-task-and-write-a-unicode-artifact",
      "sceneId": "agent-task",
      "intent": "Keep the same naming truth while agent-task work produces a deliverable.",
      "action": "Use the Unicode-named file in agent-task and write a Unicode-named artifact",
      "target": "agent-tasks__conversation-input",
      "expectedFeedback": "Agent Task 能消费原始 Unicode 文件，并产出同样保留 Unicode 文件名的 artifact。",
      "note": "AI-native 工作流不应该要求用户为了 runner 兼容性先手工改名。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "return-to-files-and-see-the-unicode-artifact-unchanged",
      "sceneId": "project-files",
      "intent": "Verify the artifact keeps the same visible name after returning to Files.",
      "action": "Return to Files and inspect the Unicode-named artifact",
      "target": "files__objects-table",
      "expectedFeedback": "回到 Files 后，artifact 继续保留原本的 Unicode 名称，没有乱码、转义串或截断名。",
      "note": "artifact continuity 是 Files 与 Agent Task 之间最容易暴露文件名漂移的地方。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "download-the-unicode-artifact-with-the-same-name",
      "sceneId": "project-files",
      "intent": "Complete the round-trip by downloading the artifact without name drift.",
      "action": "Download the Unicode-named artifact",
      "target": "files__download",
      "expectedFeedback": "下载结果继续保留同一个 Unicode 文件名，成员拿到的本地文件就是自己在产品里看到的那份成果。",
      "note": "round-trip 的终点是下载后仍然不需要重命名。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for Unicode filename continuity across Files, agent-task artifacts, and download.
