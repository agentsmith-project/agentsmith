# Engineering Docs Index

<!-- markdownlint-disable MD013 -->

This directory holds engineering-side guidance that supports implementation and maintenance. Product scope, IA, and UI style truth live elsewhere.

## Deployment Boundary

This index is not a deployment truth source; canonical deploy details stay in
the unified deploy contract and release-kit split plan. Current Docker-only /
local-kind unified deploy is only a pre-GA focused diagnostic baseline, not
long-term deployment truth. In P0, `external_declared` is only the schema,
fixture, validator, and evidence boundary; it does not mean P2/P3 real
Kubernetes, cloud, or airgap handoff is complete. AgentSmith does not give a
release verdict, and the release-kit repo owns online/airgap deployment
verdict through its own gates and evidence; kind/local-kind remains local
diagnostic support only.

Current active plan:

- [Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1](./release-kit-and-runner-repo-split-kiss-plan-v1.md) - active pre-GA plan for the release-kit / runner repo split and AgentSmith product-side boundary.

Current next blocker:

- Close AgentSmith runner support API / projection contract consistency with runner/context/credential owner evidence before treating runner runtime/backend-real readiness as ready to hand to sibling repos.
