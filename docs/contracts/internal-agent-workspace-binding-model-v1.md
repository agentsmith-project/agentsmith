# Internal Agent Workspace Binding Model

This document defines the current internal workspace binding boundary between:

- `AgentSmith` notebook/internal-agent orchestration
- AFSCP workload mount binding and orchestrator-only mount plans
- the internal sandbox workload path

## Product Truth

An internal notebook task does not reason directly about Kubernetes storage primitives.

AgentSmith asks AFSCP for a **workload mount binding** for the file library repo,
then hands a **task HOME mount contract** to the sandbox workload path. The
dedicated orchestrator consumes the AFSCP orchestrator-only mount plan and mounts
the repo payload as the task HOME. Task code only sees:

- `HOME` / `TASK_HOME`: `/home/<task_home_segment>`
- `cwd`: `/home/<task_home_segment>/workspace`
- generated deliverables under `/home/<task_home_segment>/workspace/.artifacts`

## Current Types

### Binding record

`InternalAgentWorkspaceBinding`

This is the persisted AgentSmith task binding record that remembers product and
AFSCP linkage:

- `workspace_id`, `project_id`, `task_id`, and bound file library id
- task HOME segment and binding generation
- workload id / holder / lease state used by AgentSmith admission checks
- AFSCP workload mount binding id, status, and release/drain bookkeeping
- project storage generation used when the binding was created

This record must not persist Kubernetes PV, PVC, Secret, CSI, raw mount command,
metadata URL, bucket endpoint, or storage-root credential details. Those belong
inside AFSCP and its orchestrator-only mount plan.

### Mount contract

`InternalAgentWorkspaceMount`

This is the execution-facing contract:

- `bindingId`
- `mountPath` / `taskHomePath`: `/home/<task_home_segment>`
- `workspacePath`: `/home/<task_home_segment>/workspace`
- `artifactsPath`: `/home/<task_home_segment>/workspace/.artifacts`
- no task-specific storage subdirectory; the mounted root is the bound AFSCP repo
  payload root
- optional `readOnly`

The pod manager consumes this contract and does not need to know the full binding record shape.
`workspace_binding_mode` remains an execution-source marker (`file_library` or `pre_mounted`);
it does not define any separate `/workspace/<task_id>` storage path.

## Why this boundary exists

Without a separate mount contract, orchestration code tends to pass substrate
objects around, which leaks infrastructure details into notebook execution flow.

By separating:

- persisted binding record
- execution-facing mount contract
- AFSCP orchestrator-only mount plan

the current implementation keeps product binding, storage session authority, and
pod mounting in separate layers.

## Current Direction

The target release model is:

- AgentSmith owns task-to-file-library binding admission, product generation, and
  user-visible status
- AFSCP owns repo storage truth, workload mount binding state, export/session
  accounting, and release/revoke confirmation
- the dedicated orchestrator consumes only the scoped AFSCP mount plan for one
  repo payload, destination, and TTL
- orchestration receives a task HOME mount contract and never needs substrate
  storage names
- task delete releases the task-to-file-library binding; archive keeps the binding
- file library content is retained until the file library lifecycle deletes it
