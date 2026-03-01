# Release Governance Control Plane

## Purpose

`Release Ops` is the operational control plane for release governance. It is the single place to:

1. inspect release policy and gate enforcement
2. review release report artifacts and gate run history
3. manage policy overrides and approvals
4. handle escalations, ownership, SLA, and incident history
5. trigger manual gate runs and failed-check reruns

## Main Surfaces

Project route:

```text
/[locale]/workspaces/[workspace]/projects/[project]/release-ops
```

Core sections:

1. `Release Policy`
2. `Release Reports`
3. `Gate Runs`
4. `Escalations`
5. `Incident Summary`
6. `Incident Trace`

## Operating Model

### 1. Start from policy enforcement

Use `Gate Enforcement` as the first decision signal:

1. `ready`
2. `warning`
3. `blocked`
4. `pending_override`
5. `releasable_with_override`

Interpretation:

1. `ready`: no unresolved blocker remains
2. `warning`: release is not blocked, but debt is present
3. `blocked`: unresolved blocker exists
4. `pending_override`: only overridable blockers remain and approval is still pending
5. `releasable_with_override`: blockers were explicitly approved as exceptions

### 2. Use report artifacts for acceptance baseline

Release artifacts remain the auditable acceptance source.

Check:

1. report status
2. runtime evidence
3. usage evidence
4. execution failures
5. latest policy enforcement

Do not treat a green page alone as acceptance. The artifact is still the acceptance record.

### 3. Use gate runs for execution history

Gate runs answer:

1. who triggered the run
2. what checks were requested
3. whether the run was full or failed-only rerun
4. which step failed first
5. which artifact was produced

Use rerun for:

1. transient upstream failures
2. targeted failed-check revalidation

Do not use rerun to hide structural failures. Fix the underlying issue first.

### 4. Use overrides as explicit exceptions

Overrides are scoped to:

1. workspace
2. project
3. report
4. incident
5. issue

Rules:

1. override reason is mandatory
2. reason category is mandatory
3. expiry is mandatory
4. requester cannot approve their own override
5. expired override no longer changes enforcement

### 5. Use escalations as incident workflow

Escalations are not just notifications. They carry:

1. severity
2. ownership
3. SLA state
4. resolution category
5. incident history

Expected handling path:

1. acknowledge
2. assign owner
3. set due time
4. resolve or reopen with reason/category

## Incident Workflow

Each release incident is correlated by `incident_id`.

Objects linked into one incident:

1. release report artifact
2. release gate run
3. escalation
4. override records
5. handoff history

Use `Incident Summary` for the current state:

1. open vs resolved escalations
2. pending vs approved overrides
3. latest run status
4. owner
5. SLA / resolution category

Use `Incident Trace` for chronology:

1. gate runs
2. escalations
3. acknowledgements
4. assignment / reassignment events
5. override decisions
6. resolution / reopen events

## Recommended Triage Order

1. Check `Gate Enforcement`
2. Open the latest failed report
3. Confirm whether blocker is execution, runtime, usage, or governance
4. Inspect the linked incident
5. Assign an owner and due time if escalation is open
6. Decide whether the issue needs a fix or an approved exception
7. Re-run failed checks only after the root cause is addressed

## Manual Operations

### Trigger full gate

Use the `Gate Runner` panel or:

```bash
npm run release:report -- --name <name>
```

### Trigger failed-only rerun

Use the `Gate Runner` panel on an existing failed run.

### Refresh release artifact baseline

```bash
npm run release:report -- --name <name>
```

### Review runtime and usage context

Use deep links from report detail:

1. `Runtime Observability`
2. `Usage`

## Release Acceptance Rules

Treat as blocking:

1. unresolved non-overridable blocker
2. critical escalation without owner
3. critical escalation overdue
4. runtime guardrail blocked
5. usage evidence blocked

Treat as warning:

1. open non-critical escalations
2. due-soon escalations
3. approved exception still active
4. warning-only policy issues

## Runbook Discipline

This page is the operational baseline. When release governance behavior changes, update:

1. this runbook
2. `docs/user-guides/release-verification.md`
3. `docs/plans/llm-runtime-final-implementation-plan-v2.md`
4. `docs/release/internal-release-note-2026-02-28-closure.md`
