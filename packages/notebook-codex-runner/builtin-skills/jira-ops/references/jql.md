# JQL Notes

Use JQL for issue discovery before mutation when the issue key is unknown.

Common patterns:

- project only:
  - `project = "DALO DEV"`
- summary fuzzy match:
  - `summary ~ "DCU adaptor layer on RTE api"`
- project + summary:
  - `project = "DALO DEV" AND summary ~ "DCU adaptor layer on RTE api"`
- assignee:
  - `assignee = currentUser()`
- status:
  - `status = "开放"`

Guidelines:

- Prefer exact issue keys when already known
- Use narrow JQL before mutations to avoid commenting on the wrong issue
- Request only the fields you need during search
- If the JQL is long or heavily composed, use `search --use-post`
