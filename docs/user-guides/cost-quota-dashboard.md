# Cost & Quota Dashboard User Guide

## Overview

The Cost & Quota Dashboard provides real-time visibility into your resource consumption, costs, and quota utilization. It helps you:

- Track API usage and costs across endpoints and agents
- Monitor quota limits and usage thresholds
- Identify cost trends and optimize resource allocation
- Set up alerts for quota thresholds

## Accessing the Dashboard

1. Navigate to your project
2. Click on **Usage** in the sidebar navigation
3. The dashboard displays your project's cost and quota metrics

## Dashboard Components

### 1. KPI Cards

At the top of the dashboard, you'll see key performance indicators:

- **Total Cost**: Month-to-date spending for your project
- **Request Count**: Total API requests in the selected time period
- **Quota Usage**: Percentage of quota consumed vs. limit
- **Avg Response Time**: Average API response time

### 2. Cost Chart

Visual representation of your spending over time:

- **X-axis**: Time range (daily/weekly/monthly)
- **Y-axis**: Cost in your currency
- **Line graph**: Shows cost trend over the selected period
- **Hover**: View exact cost for any time point

### 3. Quota Usage Cards

Individual cards showing quota status for each resource type:

- **Endpoint Quota**: API endpoint requests vs. limit
- **Source Library Quota**: Storage/library usage vs. limit
- **Agent Quota**: Agent executions vs. limit
- **Progress Bar**: Visual indicator of quota consumed
- **Reset Date**: When the quota resets

### 4. Top Resources Table

Ranking of highest-consuming resources:

- **Resource Name**: Endpoint, agent, or library name
- **Usage Count**: Number of requests/uses
- **Cost Impact**: Contribution to total cost
- **Trend**: Increasing/decreasing usage indicator

## Using Time Filters

Adjust the time range to analyze different periods:

1. Click the **Time Range** selector
2. Choose from preset options:
   - Last 24 hours
   - Last 7 days
   - Last 30 days
   - Custom range
3. Dashboard updates automatically

## Quota Management

### Viewing Quota Status

Each quota card displays:

- **Current Usage**: Number of requests used
- **Limit**: Maximum allowed requests
- **Percentage**: Visual progress bar
- **Status Color**:
  - 🟢 Green: Under 80% of limit
  - 🟡 Yellow: 80-95% of limit
  - 🔴 Red: Over 95% of limit

### Responding to Quota Warnings

When you approach quota limits:

1. **Review Top Resources**: Identify highest consumers
2. **Optimize Usage**: Consider reducing non-essential requests
3. **Request Increase**: Contact administrator to raise quota
4. **Set Up Alerts**: Configure notifications for future thresholds

## Cost Analysis

### Understanding Cost Breakdown

The dashboard categorizes costs by:

- **Resource Type**: Endpoints, agents, source libraries
- **Operation**: Read, write, compute operations
- **Time Period**: Daily, weekly, monthly aggregation

### Cost Optimization Tips

1. **Identify Trends**: Look for unusual spikes in usage
2. **Review Top Consumers**: Focus on highest-cost resources
3. **Optimize Frequency**: Reduce unnecessary polling/retries
4. **Cache Results**: Implement caching where appropriate

## Alert Integration

The dashboard integrates with the Alert Center for proactive monitoring:

### Setting Up Cost Alerts

1. Go to **Alert Center**
2. Create a new alert rule
3. Select **Cost** as the trigger type
4. Set threshold (e.g., "when daily cost exceeds $10")
5. Configure notification preferences

### Setting Up Quota Alerts

1. Go to **Alert Center**
2. Create a new alert rule
3. Select **Quota** as the trigger type
4. Set threshold percentage (e.g., "when quota exceeds 80%")
5. Choose notification channel (email, in-app)

## Troubleshooting

### Dashboard Not Loading

- Refresh the page
- Check your internet connection
- Verify you have `project:endpoint:use` permission

### Data Not Updating

- Data refreshes every 5 minutes
- Click the **Refresh** button to force update
- Check the time range selector

### Unexpected Cost Spikes

1. Review the **Top Resources** table
2. Check the **Cost Chart** for spike timing
3. Examine audit logs for unusual activity
4. Contact support if spike cannot be explained

## Permissions

Required permissions to access dashboard features:

- **View Dashboard**: `project:endpoint:use`
- **Export Data**: `project:manage`
- **Manage Alerts**: `project:manage`

## Related Features

- [Alert Center](./alert-center.md) - Set up cost and quota alerts
- [Audit Logs](./audit-usage-reports.md) - Review detailed usage history
- [Settings](../../DEVELOPMENT.md) - Configure project settings

## FAQ

**Q: How often does the dashboard update?**
A: Data refreshes every 5 minutes automatically.

**Q: Can I export dashboard data?**
A: Yes, use the **Export** button to download CSV/JSON reports.

**Q: What time zones are used?**
A: All times are displayed in your browser's local time zone.

**Q: How far back can I view historical data?**
A: Up to 90 days of historical data is available.

**Q: Can I compare costs across projects?**
A: Currently, the dashboard shows data for one project at a time. Navigate to different projects to compare.
