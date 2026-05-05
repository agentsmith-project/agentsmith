---
{
  "storyId": "agent-task-artifact-to-files-download",
  "title": "Agent Task artifact to files download",
  "actor": "project member",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects/{projectId}/agent-tasks/{taskId}",
  "goal": "项目成员运行 Agent Task 任务后，可以在 Files 中找到交付物并下载验证内容。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "Keycloak and provider API key are configured"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "agentTaskArtifactDownload": {
      "projectName": "Story Agent Task Artifact Download",
      "workspaceLibraryName": "Story Artifact Workspace",
      "agentTitle": "story-agent-task-artifact",
      "taskTitle": "Story agent-task artifact task",
      "artifactName": "story-agent-task-download.md",
      "artifactToken": "AGENT_TASK_ARTIFACT_DOWNLOAD_OK",
      "createPrompt": "Run the following shell command exactly.\n```bash\nmkdir -p .artifacts && cat <<'EOF' > .artifacts/story-agent-task-download.md\n# Story Artifact Deliverable\n- Token: AGENT_TASK_ARTIFACT_DOWNLOAD_OK\n- Audience: sales enablement\n- Next step: share in Files and download for review\nEOF\n```\nAfter the file is written, reply with exactly: AGENT_TASK_ARTIFACT_DOWNLOAD_OK",
      "expectedArtifactPath": ".artifacts/story-agent-task-download.md",
      "downloadPath": ".artifacts/story-agent-task-download.md"
    }
  },
  "narrative": "成员视角的 Agent Task 主故事不是 runner mount 实现，而是把 task 产物稳定交付到 Files，并允许用户完成下载确认。",
  "scenes": [
    {
      "sceneId": "agent-task-detail",
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
    }
  ],
  "steps": [
    {
      "stepId": "open-agent-task",
      "sceneId": "agent-task-detail",
      "intent": "Open the Agent Task and wait for the artifact-producing reply.",
      "action": "Open Agent Task",
      "target": "agent-task__task-header",
      "expectedFeedback": "Agent Task 已创建并生成 artifact 回复",
      "note": "Agent Task 已创建并生成 artifact 回复",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-files-artifacts",
      "sceneId": "project-files",
      "intent": "Open Files and navigate into the .artifacts folder for the task workspace.",
      "action": "Open files artifacts",
      "target": "files__objects-table",
      "expectedFeedback": "Files 中可见 Agent Task 任务写出的 artifact",
      "note": "Files 中可见 Agent Task 任务写出的 artifact",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "download-artifact",
      "sceneId": "project-files",
      "intent": "Download the generated artifact from Files and verify its contents.",
      "action": "Download artifact",
      "target": "files__download",
      "expectedFeedback": "artifact 下载成功且内容与 Agent Task 回复一致",
      "note": "artifact 下载成功且内容与 Agent Task 回复一致",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "agent-task-artifact-to-files-download",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for agent-task artifact delivery into Files.
