# MBOS Frontend — 英中 i18n 实习生操作指南

本文档说明如何在本项目中完成**全部英中国际化（i18n）**：按既定规则编写翻译条目、修改代码，并**尽量少改代码**（只改必要处）。

---

## 一、项目 i18n 现状

- **库**：`next-intl`
- **语言**：`en-US`（英文）、`zh-CN`（简体中文）
- **文案文件**（唯一来源，不要动路径）：
  - `src/messages/en-US.json` — 英文
  - `src/messages/zh-CN.json` — 中文
- **配置**：`src/i18n/request.ts` 已配置好，**无需修改**。
- **路由**：访问 `/zh-CN/...` 为中文，`/en-US/...` 为英文。

**你在代码里只需要做两件事：**

1. 在 **en-US.json 和 zh-CN.json** 里按规则**新增/补全**翻译条目。
2. 在 **组件/页面** 里用 `useTranslations()` 取文案，**替换**掉硬编码英文字符串。

---

## 二、翻译条目规则（必须遵守）

### 2.1 文件与结构

- **只改** `src/messages/en-US.json` 和 `src/messages/zh-CN.json`。
- 两个文件**必须保持同一结构**：相同的顶级 key、相同的嵌套 key，一一对应。
- Key 使用 **snake_case**（小写 + 下划线），例如：`search_placeholder`、`view_all_projects`。
- 按**功能/页面**分块，每块一个**顶级 namespace**，例如：`common`、`nav`、`auth`、`projects`、`sources`、`members`、`workbench`、`chat`、`audit`、`usage` 等（与现有文件一致）。

### 2.2 命名与复用

- **同一意思同一 key**：全项目同一句文案只对应一个 key，多处复用该 key，不要重复造 key。
- **通用文案**：按钮、状态、提示等通用语放在 `common`（如：`common.loading`、`common.save`、`common.cancel`）。
- **页面/模块专属**：该页面/模块才用到的文案放在对应 namespace（如 `projects.title`、`sources.upload`）。
- **带占位符**：用 `{name}` 形式，例如：`"count": "All Projects ({count})"`，中英文都保留相同占位符。

### 2.3 中文翻译要求

- 使用**简体中文**，用语符合产品/后台管理场景。
- 专有名词（如 Keycloak、AIReady、Workbench）可保留英文，其余尽量翻译。
- 语气统一：提示类简洁、按钮类用动词（如「保存」「取消」「创建项目」）。

### 2.4 不翻译的内容

- 代码里的变量名、组件名、key 名、API 路径。
- 用户生成内容（如项目名、文件名）。
- `console.log`、注释、开发调试用字符串。
- `aria-label`、`title`、`placeholder` 等**用户可见**的字符串需要翻译，并在 JSON 中加对应条目。

---

## 三、代码修改规则（最少改动）

### 3.1 原则

- **只改“用户可见”的字符串**：界面上的标题、按钮、提示、表格头、占位符、空状态文案等。
- **能复用就复用**：若 `common` 或已有 namespace 已有合适 key，直接用，不要新建重复 key。
- **一个组件只加一次** `useTranslations`：在**最外层**用 `useTranslations('namespace')` 得到 `t`，子组件需要时通过 **props 传 `t`**，或子组件自己再调一次 `useTranslations`（同一 namespace 或更细的如 `members.permissions`），避免为同一 namespace 在多个子组件里重复写大段逻辑。

### 3.2 标准写法（Client Component）

```tsx
'use client';

import { useTranslations } from 'next-intl';

export default function SomePage() {
  const t = useTranslations('projects');  // 选对应 namespace，和 JSON 里顶级 key 一致

  return (
    <>
      <h1>{t('title')}</h1>
      <p>{t('empty.description')}</p>
      <button>{t('empty.create_first')}</button>
      <span>{t('all.count', { count: 5 })}</span>
    </>
  );
}
```

- **Namespace**：`useTranslations('projects')` 对应 JSON 里的 `"projects": { ... }`。
- **取子 key**：`t('empty.description')` 对应 `projects.empty.description`。
- **带参数**：`t('all.count', { count: 5 })`，JSON 里为 `"all": { "count": "All Projects ({count})" }`。

### 3.3 子组件需要翻译时（最少改法）

- **推荐**：父组件已有一个 `t`，把 `t` 通过 props 传给子组件，子组件用 `t('xxx')` 即可，**子组件不必再 `useTranslations`**。
- **可选**：子组件自己 `useTranslations('同一或更细 namespace')`，例如 `useTranslations('members.permissions')`，仅当该子组件独立、复用在多处时用。

### 3.4 多个 namespace（仅当确实需要）

同一组件需要「通用 + 本页」时，可以取两个 namespace：

```tsx
const t = useTranslations('usage');
const commonT = useTranslations('common');
// 用 t('...') 和 commonT('...')
```

尽量先考虑是否都能放进一个 namespace，减少 `commonT` 的使用。

### 3.5 不要改动的部分

- **不要**改：`src/i18n/request.ts`、`next.config.ts`、`src/app/[locale]/layout.tsx`、middleware、路由配置。
- **不要**改：已有、且已用 `t('...')` 正确绑定的代码逻辑和结构；只替换**尚未翻译的硬编码字符串**。

---

## 四、操作流程（推荐顺序）

按下面顺序做，可以**最少改代码、最少重复**：

### Step 1：列出“未翻译”的界面

1. 本地跑起前端：`npm run dev` 或 `bun run dev`。
2. 用浏览器把主要页面点一遍（含侧栏、顶栏、各 Tab、弹窗、空状态、表格头）。
3. 用 `/zh-CN/...` 和 `/en-US/...` 对比，**列出仍为英文的页面/区块**（例如：登录、工作空间选择、项目列表、概览、Chat、工作台、Sources、Agents、Endpoints、Members、Audit、Usage、Settings 等）。
4. 在代码里**搜索硬编码英文字符串**（如 `"Create"`、`"Loading..."`、`Select Workspace`），定位到具体文件和行号，做成清单。

### Step 2：规划 namespace 和 key

1. 打开 `src/messages/en-US.json`，看现有顶级 key：`common`、`nav`、`auth`、`workspace`、`project`、`sources`、`members`、`workbench`、`chat`、`audit`、`usage`、`projects` 等。
2. 对每个“未翻译”的页面/模块，决定：
   - 用**已有** namespace（如 `common`、`nav`）即可，还是
   - 需要**新**顶级 namespace（如 `overview`、`agents`、`endpoints`、`settings`）。
3. 为每个要翻译的字符串设计一个 key（snake_case），并写在草稿里，例如：
   - 页面标题 → `title`
   - 空状态标题 → `empty.title`
   - 空状态描述 → `empty.description`
   - 带数字 → `all.count`，值为 `"All Items ({count})"` 等。

### Step 3：先补全 JSON（再改代码）

1. **先只改两个 JSON 文件**：
   - 在 `en-US.json` 里按上面结构**新增或补全** key，值为英文。
   - 在 `zh-CN.json` 里**完全同一结构**复制一份，值改为中文。
2. 保存后确认 JSON 合法（无多余逗号、括号匹配），可跑一下 `npm run build` 看是否有报错。

### Step 4：在代码中替换字符串（最少改动）

1. 打开对应组件/页面。
2. 若该文件**还没有** `useTranslations`：
   - 在文件顶部增加：`import { useTranslations } from 'next-intl';`
   - 在组件内部（且是顶层，不要放在条件里）增加：`const t = useTranslations('你选的 namespace');`
3. 把该文件中**用户可见**的英文字符串，逐条替换为 `t('key')` 或 `t('key', { param })`，key 与 JSON 一致。
4. 若该文件**已有** `useTranslations`：
   - 只增加 `t('...')` 的调用，或补一条 `const commonT = useTranslations('common');`（仅当确实需要通用文案时）。
5. 子组件若只需父组件的文案：由父组件传 `t` 下去，子组件用 `t('...')`，不在子组件再开一个同 namespace 的 hook（除非子组件独立复用）。

### Step 5：自测与检查

1. 浏览器访问 `/zh-CN/...`，确认该页所有目标文案变为中文。
2. 访问 `/en-US/...`，确认仍为英文且无缺 key 的空白或报错。
3. 有占位符的地方（如 `{count}`）换不同数字测一下。
4. 若发现 key 漏写或写错，**只改 JSON 和对应的 `t('...')` 参数**，不要改 i18n 配置或布局。

---

## 五、命名空间与文件对应参考

| 功能/页面           | 建议 namespace     | 主要文件位置（仅供参考，以实际硬编码为准） |
|---------------------|--------------------|--------------------------------------------|
| 通用按钮/状态/提示  | `common`           | 多处复用                                   |
| 顶栏、侧栏、导航    | `nav`              | `Topbar`、`Sidebar`、导航相关              |
| 登录、选工作空间    | `auth`             | `login/page.tsx`、`login/workspace/page.tsx` |
| 工作空间/项目选择   | `workspace`、`project` | Topbar、Switcher 等                     |
| 项目列表            | `projects`         | `workspaces/[workspace]/projects/page.tsx`（已部分完成） |
| 概览                | `overview`（若无则新建） | `overview/page.tsx`                    |
| 聊天                | `chat`             | `chat/` 下页面与组件                       |
| 工作台 / Recipe     | `workbench`        | `workbench/` 下页面与组件                  |
| 文件 / Sources      | `sources`          | `sources/` 下页面与组件                    |
| 智能体              | `agents`（若无则新建） | `agents/page.tsx`                      |
| 端点                | `endpoints`（若无则新建） | `endpoints/page.tsx`                 |
| 成员 / 权限 / 配额  | `members`          | `members/` 下页面与组件                    |
| 审计                | `audit`            | `audit-usage/` 中审计相关                  |
| 用量                | `usage`            | `audit-usage/` 中用量相关                   |
| 设置                | `settings`（若无则新建） | `settings/page.tsx`                   |
| 错误/Toast          | `errors`           | `use-error-handler`、Toast 等              |

先查 `en-US.json` 里是否已有对应顶级 key，有则直接在里面加子 key，没有则新建顶级 key 并在 `zh-CN.json` 里同步一份。

---

## 六、示例：只做“最少代码修改”的一页

假设要给 **Overview 页** 做 i18n，且当前全是硬编码英文：

1. **在 JSON 里加 namespace**（若还没有）  
   - `en-US.json` 和 `zh-CN.json` 都加：
   - `"overview": { "title": "Overview", "welcome": "Welcome to your project", ... }`
   - 中文：`"overview": { "title": "概览", "welcome": "欢迎使用本项目", ... }`

2. **在 Overview 页面组件里**  
   - 加：`import { useTranslations } from 'next-intl';`  
   - 加：`const t = useTranslations('overview');`  
   - 把 `<h1>Overview</h1>` 改为 `<h1>{t('title')}</h1>`  
   - 把其它可见英文同样改成 `t('...')`  

3. **不改**：路由、layout、request 配置、其它不涉及该页的组件。

---

## 七、常见问题

- **页面还是英文？**  
  检查：① 该页是否已用 `useTranslations` 且 namespace 与 JSON 一致；② 浏览器访问的是否为 `/zh-CN/...`；③ JSON 里是否真有该 key 且无拼写错误。

- **缺 key 报错或空白？**  
  在对应 locale 的 JSON 里补上该 key，保证中英文两个文件结构一致。

- **带变量的文案？**  
  JSON 里用 `{变量名}`，如 `"count": "共 {count} 项"`，代码里 `t('count', { count: 5 })`。

- **同一句文案多处出现？**  
  只保留一个 key（优先放 `common` 或最合适的 namespace），多处都调 `t('同一key')`。

---

## 八、完成标准

- 所有面向用户的界面文案（按钮、标题、提示、表头、空状态、占位符、aria 等）在 **en-US** 下为英文、在 **zh-CN** 下为简体中文。
- `en-US.json` 与 `zh-CN.json` 结构完全一致，无多余或缺失 key。
- 仅做了“加/补翻译条目”和“用 `t('...')` 替换硬编码”的修改，未动 i18n 配置与路由。
- 本地用 `/zh-CN/...` 与 `/en-US/...` 各点一遍主要流程，无报错、无空白、无仍为英文的界面。

按上述规则和方法操作，即可在**最少改代码**的前提下完成全部英中 i18n；若遇与现有实现不一致的地方，以本指南和现有 `en-US.json` / `zh-CN.json` 结构为准。

---

## 九、快速参考

| 操作 | 做法 |
|------|------|
| 加一条文案 | 在 `en-US.json` 和 `zh-CN.json` 的**同一路径**下加同一 key，值分别为英文/中文。 |
| 在组件里用 | `import { useTranslations } from 'next-intl';` → `const t = useTranslations('namespace');` → `{t('key')}` 或 `{t('key', { param: value })}`。 |
| 子组件用父的文案 | 父组件把 `t` 通过 props 传给子组件，子组件用 `t('key')`，**子组件不必再 useTranslations**。 |
| 占位符 | JSON：`"count": "共 {count} 项"`；代码：`t('count', { count: 5 })`。 |
| 通用文案 | 优先用 `common` 下已有 key；没有再在 `common` 里加，不要为同一意思造多个 key。 |

---

## 十、工作清单（可打印/勾选）

- [ ] 通读本指南，跑一遍 `/zh-CN/` 和 `/en-US/`，列出仍为英文的页面/区块。
- [ ] 在代码中搜索硬编码英文字符串，整理成「文件 + 行号 + 建议 key」清单。
- [ ] 按 namespace 规划：哪些用 `common`，哪些用已有 namespace，哪些需新建。
- [ ] 先只改两个 JSON：补全 `en-US.json` 和 `zh-CN.json`，保证结构一致。
- [ ] 按页面/模块逐个改代码：加 `useTranslations`、用 `t('...')` 替换硬编码。
- [ ] 自测：`/zh-CN/...` 全为中文，`/en-US/...` 全为英文，无缺 key、无报错。
- [ ] 提交前再跑一次 `npm run build`，确认无破坏性修改。
