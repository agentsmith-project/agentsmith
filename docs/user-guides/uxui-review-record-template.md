# UX/UI 审查记录模板

这是一份供团队重复复制使用的 Markdown 模板。

用途：
- 记录一次 `local_manual` 或 `release_grade` 的人工 UX/UI 审查
- 让不同人执行审查时，输出结构保持一致
- 让“已足够好 / 建议改进 / 阻塞审查”的结论可比较、可追溯

它不是：
- official gate truth
- machine-readable evidence schema
- 新的 evidence owner 定义

使用前，先阅读：
- [UX/UI 审查运行手册](./uxui-review-runbook.md)
- [视觉基线审查与交付规范 v1](../UXUI/00-设计系统/视觉基线审查与交付规范-v1.md)
- [站点页面配方与壳层规范 v1](../UXUI/00-设计系统/站点页面配方与壳层规范-v1.md)

使用方式：
1. 复制本模板到当前 review note、PR 附件、run-scoped review note 或团队协作文档中。
2. 删掉不适用的章节，不要保留空模板污染最终记录。
3. 自动化 verdict 与人工 verdict 分层记录，不要混写。
4. 每个 scene 只允许一个最终结论：`已足够好，无需改动`、`建议改进`、`阻塞审查`。

---

## 1. 审查头信息

```md
# <本次审查名称>

- review_id:
- date:
- reviewer:
- mode: ui_only | local_manual | release_grade
- scope_summary:
- change_scope:
- related_story_or_ticket:
- related_routes_or_modules:
- environment_notes:
```

示例：
- `mode` 写 `local_manual` 或 `release_grade`
- `scope_summary` 写“project work surfaces + governance overlays”
- `change_scope` 写“新增 notebook trace panel 与 files 挂载说明交互”

---

## 2. 自动化结果摘要

```md
## 自动化结果摘要

- selected_entry:
- commands_run:
  - 
  - 
- automated_verdict:
- evidence_status:
- key_artifacts:
  - 
  - 
- notes:
```

填写规则：
- `automated_verdict` 只写自动化结果，不写人工审查意见
- `evidence_status` 说明 evidence 是否完整，例如：
  - `full visual complete`
  - `backend-real trace complete`
  - `missing review artifact`
- `key_artifacts` 填当前真实存在的 review/evidence 路径

---

## 3. 审查范围清单

```md
## 审查范围

| 审查分组 | scene / route / overlay | state | theme | recipe_family | included |
| --- | --- | --- | --- | --- | --- |
| Entry & Bootstrap |  |  |  |  | yes/no |
| Workspace Surfaces |  |  |  |  | yes/no |
| User Self-Service |  |  |  |  | yes/no |
| Project Work Surfaces |  |  |  |  | yes/no |
| Project Governance & Ops |  |  |  |  | yes/no |
| Redirect / Callback / Preview Pack |  |  |  |  | yes/no |
```

填写规则：
- `审查分组` 用 runbook 里的默认分组
- `state` 最少写 `default ready` + 一个主交互态或详情态
- `theme` 默认写 `light,dark`
- `included` 明确说明是否纳入正式结论

如果某一组未纳入：
- 在备注里写清楚为什么不纳入，例如 `callback smoke only`

---

## 4. 场景审查模板

下面这段按 scene 复制。

```md
## <审查分组> / <scene 名称>

- route:
- overlay:
- state:
- theme:
- recipe_family:
- story_or_code_ref:
- evidence:
- first_impression:
- verdict: 已足够好，无需改动 | 建议改进 | 阻塞审查
- priority: none | P0 | P1 | P2 | P3

### 审查要点

- page_syntax_and_shell:
- task_clarity_and_first_impression:
- structure_and_surface:
- cta_hierarchy:
- state_completeness:
- overlay_choice:
- light_dark_parity:
- copy_and_product_semantics:

### Reason

<写清楚为什么给出这个结论。>

### Suggestion

<如果无需改动，写“无需改动，保持当前实现更合理”，并说明理由。>
<如果建议改进，写问题、影响、建议动作。>
<如果阻塞审查，写阻塞原因和最小修复方向。>
```

---

## 5. 已足够好模板

当你判断“已经足够好”时，建议使用下面这段，避免只写一句“没问题”。

```md
### Reason

该 scene 已落在正确的 recipe family 内，主任务与主动作在第一眼内可识别，shell 明显轻于内容，结构主要依靠 spacing、type rhythm 和 divider 建立，没有出现 page-local shell、dashboard trope 或 light/dark 构图漂移。

### Suggestion

无需改动，保持当前实现更合理。继续增加卡片、强调色、总结条或额外说明壳层，只会增加噪声，不会提升任务清晰度。
```

---

## 6. 建议改进模板

当你判断“需要改进，但不阻塞放行”时，建议按下面结构写。

```md
### Reason

当前问题是：
- 

造成的影响是：
- 

它为什么还没有到阻塞级别：
- 

### Suggestion

- 建议动作:
- 预期收益:
- 不建议采用的方向:
```

---

## 7. 阻塞审查模板

当你判断“当前不能接受”时，建议按下面结构写。

```md
### Reason

当前阻塞点是：
- 

阻塞类型：
- visual drift | interaction regression | state gap | permission clarity gap | evidence missing

为什么阻塞：
- 

### Suggestion

- 最小修复方向:
- 修复后需要复验的 state/theme:
- 是否需要重新生成 evidence:
```

---

## 8. 改进建议汇总

```md
## 改进建议汇总

| id | scene | priority | category | summary | reason | suggested_action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 |  | P1 | shell / hierarchy / state / copy / overlay / parity |  |  |  |
| 2 |  | P2 | shell / hierarchy / state / copy / overlay / parity |  |  |  |
```

使用规则：
- `category` 尽量用固定词，便于后续比较
- 如果某条建议是“保持不动”，不要放进这个表

---

## 9. 不纳入正式结论的观察

```md
## 不纳入正式结论的观察

- 
- 
```

适合记录：
- callback / redirect 的 smoke 观察
- 上游短时波动
- 文案讨论但不构成当前改动义务
- 需要后续专项盘点的问题

---

## 10. 最终结论

```md
## 最终结论

- manual_verdict: 已足够好，无需改动 | 建议改进 | 阻塞审查
- summary:
- blocking_items:
  - 
  - 
- accepted_scenes:
  - 
  - 
- scenes_requiring_changes:
  - 
  - 
- next_action:
```

填写规则：
- `manual_verdict` 是人工结论，不等于 automated verdict
- 如果是 `已足够好，无需改动`，`blocking_items` 应为空
- 如果是 `建议改进`，说明建议是否属于当前迭代必须处理
- 如果是 `阻塞审查`，必须明确最小修复方向

---

## 11. 推荐写法约束

为了让模板长期可用，建议遵守：

- 尽量写 scene truth，不写泛泛审美评论
- 尽量写“为什么这会影响任务理解或一致性”，而不是只写“看起来不高级”
- 不用“更像 dashboard / 更有设计感”作为单独改动依据
- 自动化结论和人工结论分层表达
- 如果认为不需要改，明确写出“不改更合理”的原因

---

## 12. 最小可复制版本

如果你只需要最短模板，可直接复制下面这段。

```md
# <审查名称>

- review_id:
- date:
- reviewer:
- mode:
- scope_summary:

## 自动化结果摘要

- commands_run:
- automated_verdict:
- evidence_status:

## Scene Review

### <scene 名称>

- route:
- state:
- theme:
- recipe_family:
- evidence:
- verdict: 已足够好，无需改动 | 建议改进 | 阻塞审查
- priority:
- reason:
- suggestion:

## 最终结论

- manual_verdict:
- summary:
- next_action:
```
