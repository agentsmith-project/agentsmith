# Common Workflows

## Search By Project + Summary

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  search \
  --jql 'project = "DALO DEV" AND summary ~ "DCU adaptor layer on RTE api"'
```

Use POST search for long JQL:

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  search \
  --use-post \
  --jql 'project = "DALO DEV" AND status in ("开放","进行中") AND summary ~ "DCU adaptor layer on RTE api"'
```

## Read Issue

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  get-issue ASWINF-106 \
  --fields summary,description,status,assignee,comment
```

## Add Comment

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  add-comment ASWINF-106 \
  --body 'This is a test'
```

## Inspect Editable Fields

Before changing fields on an unfamiliar issue type or project:

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  editmeta ASWINF-106
```

## Transition Issue

List valid transitions first:

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  list-transitions ASWINF-106 \
  --expand-fields
```

Then transition with an id:

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  transition ASWINF-106 \
  --transition-id 31 \
  --comment 'Moving this issue forward'
```

If the transition screen requires fields such as `resolution`, provide them explicitly:

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  transition ASWINF-106 \
  --transition-id 31 \
  --fields-json '{"resolution":{"name":"Done"}}'
```

## Edit Basic Fields

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  edit-fields ASWINF-106 \
  --fields-json '{"summary":"New summary"}'
```

Prefer `editmeta` first if field names, editability, or allowed values are unclear.
