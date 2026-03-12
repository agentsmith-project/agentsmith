# Audit & Usage Reports User Guide

Scope boundary (current MVP): this guide is constrained to project-scoped governance surfaces and endpoint-centric LLM usage evidence. Do not interpret it as organization-wide governance or DevOps release-management capability.

## Overview

The Audit & Usage Reports provide comprehensive visibility into:

- **Audit Logs**: Complete record of governance actions and system events
- **Usage Metrics**: Resource consumption patterns and trends
- **Export Capabilities**: Download data for external analysis

## Accessing Audit & Usage

1. Navigate to your project
2. Click on **Audit** or **Usage** in the sidebar navigation
3. View real-time data and historical reports

## Audit Logs

### Understanding Audit Events

Each audit event captures:

- **Actor**: Who performed the action (user, agent, system)
- **Action**: What was done (create, update, delete, invoke)
- **Target**: What was affected (resource type, ID)
- **Timestamp**: When the action occurred
- **Result**: Success or failure
- **Request ID**: For tracing and debugging

### Audit Event Structure

Standardized audit events include:

```json
{
  "actor": {
    "type": "user",
    "id": "user_123",
    "name": "John Doe"
  },
  "target": {
    "type": "endpoint",
    "id": "endpoint_456",
    "workspace_id": "ws_default",
    "project_id": "proj_001"
  },
  "action": "endpoint.invoke",
  "at": "2026-02-27T10:30:00Z",
  "request_id": "req_789",
  "result": "success"
}
```

### Viewing Audit Logs

1. Go to **Audit** page
2. The audit table displays events with columns:
   - **Timestamp**: When the event occurred
   - **Actor**: User or system that performed the action
   - **Action**: Type of action taken
   - **Target**: Resource that was affected
   - **Result**: Success or failure status

### Filtering Audit Events

Use the filter panel to narrow results:

#### By Time Range

- **Last 24 hours**: Recent activity
- **Last 7 days**: Week overview
- **Last 30 days**: Monthly view
- **Custom Range**: Specify exact dates

#### By Action Type

Select specific action categories:

- **Project Actions**: create, update, delete
- **Agent Actions**: create, invoke, update
- **Endpoint Actions**: invoke, create, delete
- **Member Actions**: invite, update, remove
- **Policy Actions**: create, update, delete

#### By Actor Type

Filter by who performed actions:

- **Users**: Human user actions
- **Agents**: Automated agent actions
- **System**: System-generated events

#### By Result

Show only specific outcomes:

- **Success**: Completed actions
- **Failure**: Failed or denied actions
- **All**: Both success and failure

### Viewing Event Details

1. Click the **•••** menu on any audit row
2. Select **View Details**
3. The detail drawer shows:
   - Full event information
   - Request/response metadata
   - Diff for update operations
   - Related events by request ID

### Search Functionality

Find specific events using the search bar:

- **Actor ID**: Search by user or agent ID
- **Resource ID**: Find actions on specific resources
- **Request ID**: Trace related operations
- **Text Search**: Search across all fields

## Usage Reports

### Usage Metrics Overview

The Usage page displays:

- **Request Volume**: Total API calls over time
- **Cost Trend**: Spending patterns
- **Limit Utilization**: Endpoint matrix (`rate limit` + `spending limit` by window)
- **Error Rates**: Failed request percentage
- **Personal Visibility**: What I have consumed on a specific endpoint and window, without requiring project-wide aggregate interpretation

### Usage Time Series

View metrics over time:

1. Select time range (day/week/month)
2. Chart updates to show:
   - **Request Count**: Line graph of API calls
   - **Cost**: Bar chart of spending
   - **Limits**: Endpoint-grouped window rows (`used/max/remaining/usage_pct`)

### Resource Breakdown

See usage by resource type:

- **Endpoints**: Per-endpoint request/cost and limit windows
- **No forced overall total**: The page should not require a single project-wide aggregate across mixed limit metrics

## Exporting Data

### Export Formats

Audit and usage data can be exported in:

- **JSON**: Structured data for programmatic use
- **CSV**: Spreadsheet-compatible format

### Exporting Audit Logs

1. Apply filters to narrow data
2. Click **Export** button
3. Select format (JSON/CSV)
4. File downloads with current filter results

### Exporting Usage Reports

1. Select time range and metrics
2. Click **Export Report**
3. Choose format:
   - **CSV**: With chart data as columns
   - **JSON**: Structured with metric breakdown
4. File includes all selected time series data

### Export Best Practices

- **Narrow Filters**: Export only relevant data to reduce file size
- **JSON for Automation**: Use JSON for scripts and integrations
- **CSV for Analysis**: Use CSV for Excel/spreadsheet analysis
- **Regular Exports**: Schedule exports for compliance reporting

## Use Cases

### Compliance Auditing

Demonstrate compliance with internal policies:

1. Filter by relevant action types
2. Export to CSV/JSON for records
3. Include in compliance reports

Example: "Show all policy changes in last quarter"

### Security Investigation

Investigate suspicious activity:

1. Search by actor ID or resource
2. View request chains by request ID
3. Examine failure results for denied access

Example: "Who accessed this endpoint yesterday?"

### Cost Analysis

Analyze spending patterns:

1. View usage by resource type
2. Identify top consumers
3. Correlate with cost trends

Example: "Which endpoints drive 80% of costs?"

### Performance Debugging

Trace request flows:

1. Search by request ID
2. See all related events
3. Identify failure points

Example: "Why did this request fail?"

## Permissions

Required permissions:

- **View Audit**: `project:manage`
- **View Usage**: `project:endpoint:use`
- **Export Data**: `project:manage`
- **View Details**: `project:manage` (audit detail) / `project:endpoint:use` (usage detail)

## Troubleshooting

### Audit Logs Not Loading

- Refresh the page
- Check time range selector (default: last 24 hours)
- Verify you have `project:manage` permission

### No Events Showing

- Expand time range
- Clear filters
- Check if project has recent activity

### Export Failing

- Reduce date range (large exports may timeout)
- Clear browser cache
- Check network connection

### Slow Performance

- Narrow date range
- Reduce number of active filters
- Use pagination for large result sets

## Data Retention

- **Audit Events**: Retained for 90 days
- **Usage Metrics**: Aggregated daily, retained for 1 year
- **Export Data**: No retention limit once downloaded

## Related Features

- [Cost & Limits Dashboard](./cost-limits-dashboard.md) - Visual usage metrics
- [Alert Center](./alert-center.md) - Set up usage-based alerts
- [API Documentation](../contracts/API_GUIDE.md) - API access to audit data

## FAQ

**Q: How quickly do audit events appear?**
A: Events are logged in real-time and appear within seconds.

**Q: Can I export all audit history?**
A: You can export up to 10,000 events per request. Use date ranges for larger exports.

**Q: Are audit logs tamper-proof?**
A: Yes, audit logs are write-once and cannot be modified.

**Q: Can I access audit logs programmatically?**
A: Yes, use the Audit API endpoint with proper authentication.

**Q: What's the difference between Usage and Audit?**
A: Usage shows aggregated metrics and costs; Audit shows individual events with full context.
