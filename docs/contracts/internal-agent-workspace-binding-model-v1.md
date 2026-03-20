# Internal Agent Workspace Binding Model

This document defines the current internal workspace binding boundary between:

- `AgentSmith` notebook/internal-agent orchestration
- the internal sandbox workload path

## Product Truth

An internal notebook task does not reason directly about Kubernetes storage primitives.

The orchestration layer asks for a **workspace binding** for a file library, and receives a
**workspace mount contract** that can be handed to the sandbox pod manager.

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
- `claimName`
- `mountPath`
- optional `readOnly`

The pod manager consumes this contract and does not need to know the full binding record shape.

## Why this boundary exists

Without a separate mount contract, orchestration code tends to pass anonymous PVC-shaped
objects around, which leaks infrastructure details into notebook execution flow.

By separating:

- persisted binding record
- execution-facing mount contract

we keep the current implementation compatible while moving toward a more platform-owned binding lifecycle.

## Current Limitation

Today AgentSmith still owns `ensure Secret / PV / PVC` for the binding lifecycle.

That is acceptable for the current release candidate baseline, but the intended long-term model is:

- the binding lifecycle becomes a stable platform capability
- orchestration asks for a binding and receives a mount contract
- lower layers own the storage resource lifecycle
