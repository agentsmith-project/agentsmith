# Internal Agent Workspace Binding Model

This document defines the current internal workspace binding boundary between:

- `AgentSmith` notebook/internal-agent orchestration
- the internal sandbox workload path

## Product Truth

An internal notebook task does not reason directly about Kubernetes storage primitives.

The orchestration layer asks for a **workspace binding** for a file library, and receives a
**task HOME mount contract** that can be handed to the sandbox pod manager.

## Current Types

### Binding record

`InternalAgentWorkspaceBinding`

This is the persisted control-plane record that remembers:

- which file library is bound
- which workspace/project it belongs to
- which namespace/PV/PVC/Secret names were ensured
- which CSI storage settings were used

This record remains infrastructure-facing.

### Mount contract

`InternalAgentWorkspaceMount`

This is the execution-facing contract:

- `bindingId`
- `mountPath` / `taskHomePath`: `/home/<task_home_segment>`
- `workspacePath`: `/home/<task_home_segment>/workspace`
- `artifactsPath`: `/home/<task_home_segment>/workspace/.artifacts`
- `subPath`: `agent-tasks/<task_home_segment>`
- optional `readOnly`

The pod manager consumes this contract and does not need to know the full binding record shape.
`workspace_binding_mode` remains an execution-source marker (`file_library` or `pre_mounted`);
it does not define a legacy `/workspace/<task_id>` path.

## Why this boundary exists

Without a separate mount contract, orchestration code tends to pass anonymous PVC-shaped
objects around, which leaks infrastructure details into notebook execution flow.

By separating:

- persisted binding record
- execution-facing mount contract

the current implementation follows the platform-owned binding lifecycle instead of carrying a compatibility bridge.

## Current Direction

The target release model is:

- sandbox owns the binding lifecycle
- orchestration asks for a binding and receives a task HOME mount contract
- lower layers own the JuiceFS CSI resource lifecycle
- task delete owns cleanup of the `agent-tasks/<task_home_segment>` subtree; archive keeps it
