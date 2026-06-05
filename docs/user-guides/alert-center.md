# Alert Center User Guide

Scope boundary: alerts are project-scoped operational signals for governance
evidence and endpoint policy hot spots. This is not a release orchestration,
DevOps pipeline, budget-management, email-delivery, or external notification
platform feature.

## Overview

The Alert Center helps project members:

- Create project alert rules for supported cost, limit, rate-limit, policy, and endpoint-error signals.
- View in-app alert notifications.
- Mark notifications as read or dismissed.
- Navigate from an alert to related Audit or Usage context when an action is available.

## Accessing Alert Center

1. Navigate to your project.
2. Open **Alerts** from project operational links, the alert bell, or the direct project `alerts` route when it is available in your deployment.
3. Use the **Rules** tab to manage alert rules.
4. Use the **Notifications** tab to review in-app alerts.

Current IA note: Alert Center is an operational support surface. It is not
required to appear as a primary sidebar item and must not be treated as a
release orchestration or project governance launcher.

## Alert Rules

An alert rule defines:

- Trigger condition.
- Severity.
- Enabled status.
- In-app notification behavior.

### Creating An Alert Rule

1. Go to **Alert Center** -> **Rules**.
2. Click **Create Rule**.
3. Enter a name and optional description.
4. Choose a supported metric, operator, threshold, and time window.
5. Choose severity and in-app notification settings.
6. Save the rule.

### Supported Signal Areas

- Cost: project endpoint cost signals exposed by the current Usage contract.
- Limit: endpoint limit utilization signals.
- Rate limit: throttled request signals.
- Policy: denied policy events.
- Endpoint error: endpoint failure signals.

Alert rules are project-scoped. They do not create organization-wide budget
policy, delivery workflows, or external incident integrations.

### Managing Alert Rules

From the **Rules** tab:

- View configured rules and status.
- Edit a rule.
- Enable or disable a rule.
- Delete a rule.
- Test a rule when the action is available.

## Notifications

The **Notifications** tab shows triggered in-app alert instances.

Each notification includes:

- Severity.
- Title and message.
- Timestamp.
- Status.
- Related action when the backend provides one.

### Notification Actions

- Mark as read.
- Dismiss.
- Open details or related context when available.

Dismissed notifications are hidden from the active view. This guide does not
define retention, archival export, or automatic dismissal guarantees.

## Permissions

Required permissions:

- View Alerts: `project:audit:read`.
- Create, update, test, or delete rules: `project:governance:update`.
- Update notification status: `project:audit:read`.

## Troubleshooting

### No Rules Or Notifications Appear

- Refresh the page.
- Confirm you are in the expected workspace and project.
- Verify your project permissions.
- Check Audit and Usage for related source events.

### Expected Alert Did Not Fire

- Confirm the rule is enabled.
- Confirm the trigger metric and window match the source event.
- Check whether the underlying Audit or Usage event exists.
- Adjust the threshold if the rule is too narrow.

### Too Many Alerts

- Disable low-value rules.
- Raise thresholds.
- Use severity consistently.
- Prefer a small number of actionable rules over broad catch-all rules.

## Related Features

- [Audit & Usage](./audit-usage-reports.md) - Investigate source events and endpoint usage context.

## FAQ

**Q: Can alerts notify email, chat, or incident tools?**
A: Not as a GA user-guide guarantee. Treat Alert Center as an in-app project alert surface unless your deployment has a separately documented integration.

**Q: Can alerts enforce budgets?**
A: No. Alerts can show project operational signals, but this guide does not define a budget-management or enforcement platform.

**Q: Do alerts persist after I dismiss them?**
A: Dismissed alerts are hidden from the active view. Retention is governed by the backend and deployment policy, not by this guide.
