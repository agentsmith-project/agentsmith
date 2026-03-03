# Alert Center User Guide

## Overview

The Alert Center helps you stay informed about important events in your project by:

- Creating custom alert rules for cost, quota, and policy events
- Receiving real-time notifications via in-app alerts
- Managing alert preferences and notification channels
- Viewing alert history and resolution status

## Accessing Alert Center

1. Navigate to your project
2. Click on **Alerts** in the sidebar navigation
3. The Alert Center opens with two tabs:
   - **Rules Tab**: Manage alert rule configurations
   - **Notifications Tab**: View received alerts

## Alert Rules

### Understanding Alert Rules

An alert rule defines:
- **Trigger Condition**: When to fire the alert
- **Severity**: Importance level (Info, Warning, Error, Critical)
- **Notification Method**: How you're notified
- **Enabled Status**: Whether the rule is active

### Creating an Alert Rule

1. Go to **Alert Center** → **Rules** tab
2. Click the **Create Rule** button
3. Configure the rule:
   - **Name**: Descriptive name for the rule
   - **Trigger Type**: Select from:
     - Cost: Daily/weekly spending thresholds
     - Quota: Resource usage percentage
     - Rate Limit: API request rate exceeded
     - Policy: Access denied events
     - Endpoint Error: API endpoint failures
   - **Threshold**: Set the trigger value
   - **Severity**: Choose severity level
   - **Notifications**: Select delivery method
4. Click **Save** to activate the rule

### Trigger Types Explained

#### Cost Alerts

Notify when spending exceeds a threshold:

- **Daily Cost**: Alert when single-day spending exceeds amount
- **Weekly Cost**: Alert when weekly spending exceeds amount
- **Budget Alert**: Alert when approaching monthly budget

Example: "Alert when daily cost exceeds $10"

#### Quota Alerts

Notify when resource usage nears limits:

- **Endpoint Quota**: API request count vs. limit
- **Source Library Quota**: Storage usage vs. limit
- **Agent Quota**: Agent execution count vs. limit

Example: "Alert when endpoint quota exceeds 80%"

#### Rate Limit Alerts

Notify when API rate limits are hit:

- Detects excessive request rates
- Identifies throttled endpoints
- Helps prevent service disruption

#### Policy Alerts

Notify when access control policies deny requests:

- Allow-list denials
- Permission requirements
- Unauthorized access attempts

#### Endpoint Error Alerts

Notify when API endpoints fail:

- 5xx server errors
- Connection failures
- Timeout events

### Managing Alert Rules

From the **Rules** tab:

- **View Rules**: See all configured rules with status
- **Edit Rule**: Click rule card to modify settings
- **Enable/Disable**: Toggle switch to activate/deactivate
- **Delete Rule**: Remove unwanted rules

### Rule Status Indicators

- 🟢 **Enabled**: Rule is active and monitoring
- 🔴 **Disabled**: Rule is inactive
- 🟡 **Paused**: Rule temporarily suspended

## Notifications

### Viewing Notifications

1. Go to **Alert Center** → **Notifications** tab
2. See list of received alerts
3. Each notification shows:
   - **Severity**: Color-coded indicator
   - **Title**: Brief description
   - **Message**: Detailed information
   - **Timestamp**: When the alert fired
   - **Status**: Unread/Read/Dismissed

### Notification Actions

- **Mark as Read**: Remove unread indicator
- **Dismiss**: Hide from active notifications
- **View Details**: Open full alert information
- **Take Action**: Navigate to related resource

### Notification Severities

| Severity | Color | Description | Example |
|----------|-------|-------------|---------|
| **Info** | Blue | Informational | Daily summary |
| **Warning** | Yellow | Caution advised | Quota at 80% |
| **Error** | Orange | Action required | Quota exceeded |
| **Critical** | Red | Immediate attention | Service down |

### Managing Notifications

#### Bulk Actions

1. Select multiple notifications using checkboxes
2. Choose action:
   - **Mark All as Read**
   - **Dismiss Selected**
   - **Export to CSV**

#### Filtering

Filter notifications by:
- **Severity**: Show only critical alerts
- **Type**: Cost, quota, policy, etc.
- **Date Range**: Specific time period
- **Status**: Unread vs. all

#### Auto-Dismiss Settings

Configure automatic dismissal:

1. Go to **Settings** → **Alert Preferences**
2. Set auto-dismiss duration:
   - 24 hours for Info
   - 7 days for Warning
   - Never dismiss Critical

## Alert Bell Icon

The bell icon in the top navigation shows:

- **Badge Count**: Number of unread notifications
- **Color**: Red for critical, blue for normal
- **Click**: Opens notification dropdown

### Notification Dropdown

Quick view of recent alerts:
- Shows last 10 notifications
- Click to view details
- Mark as read on dismiss

## Alert Preferences

### Notification Channels

Configure where alerts are delivered:

1. Go to **Settings** → **Notifications**
2. Enable channels:
   - ✅ **In-App**: Show in Alert Center
   - ✅ **Email**: Send to registered email
   - ✅ **Webhook**: POST to external URL

### Severity Thresholds

Choose minimum severity to notify:

- **All Alerts**: Receive everything
- **Warning and Above**: Filter out Info
- **Error and Above**: Only urgent issues
- **Critical Only**: Emergency situations

### Quiet Hours

Set times to suppress non-critical alerts:

1. Go to **Settings** → **Quiet Hours**
2. Configure:
   - **Start Time**: When quiet period begins
   - **End Time**: When quiet period ends
   - **Timezone**: Your local timezone
   - **Critical Override**: Always receive critical alerts

## Best Practices

### Creating Effective Rules

1. **Set Meaningful Thresholds**: Avoid alert fatigue
   - Don't alert on every minor fluctuation
   - Use percentage-based thresholds for quotas
   - Set cost alerts based on budget

2. **Use Severity Appropriately**:
   - Critical: Service down, quota exceeded
   - Error: Action required soon
   - Warning: Approaching limit
   - Info: Informational updates

3. **Test Your Rules**:
   - Create rule with low threshold
   - Verify notification is received
   - Adjust threshold before production use

### Managing Alert Volume

If you receive too many alerts:

1. **Review Active Rules**: Disable low-priority rules
2. **Adjust Thresholds**: Increase trigger values
3. **Set Quiet Hours**: Suppress non-urgent alerts
4. **Use Severity Filtering**: Only notify on high severity

### Troubleshooting

#### Not Receiving Expected Alerts

- Check rule is **enabled**
- Verify threshold values
- Confirm notification channel is active
- Check quiet hours settings

#### Too Many False Alerts

- Adjust thresholds to reduce noise
- Use severity filtering
- Combine multiple conditions

#### Alerts Not Dismissing

- Check auto-dismiss settings
- Manually dismiss old alerts
- Verify rule is still relevant

## Permissions

Required permissions:

- **View Alerts**: `project:endpoint:use`
- **Create Rules**: `project:settings:manage`
- **Delete Rules**: `project:settings:manage`
- **Export Alerts**: `project:settings:manage`

## Related Features

- [Cost & Quota Dashboard](./cost-quota-dashboard.md) - Monitor metrics that trigger alerts
- [Audit Logs](./audit-usage-reports.md) - Investigate alert causes
- [Settings](../../DEVELOPMENT.md) - Configure alert preferences

## FAQ

**Q: How many alert rules can I create?**
A: There's no fixed limit. Create as many as needed for your monitoring requirements.

**Q: Can I set up alerts for multiple projects?**
A: Yes, navigate to each project and configure rules separately.

**Q: Do alerts persist after I dismiss them?**
A: Dismissed alerts are hidden but retained in your history for 30 days.

**Q: Can I forward alerts to external systems?**
A: Yes, use webhooks to integrate with Slack, PagerDuty, or other tools.

**Q: What happens if I exceed quota?**
A: You'll receive a critical alert. The system may throttle requests depending on your plan.
