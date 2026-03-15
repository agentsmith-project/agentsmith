# 用户身份与权限模型

## 目标

这份文档约束 AgentSmith 当前 MVP 的用户身份与权限管理方式，避免再次回到“email 和内部 id 混用、自由字符串直接授予权限”的状态。

## 统一原则

1. 内部唯一主键固定为 `user_id = Keycloak sub`
2. 管理界面的主识别信息使用 `email`
3. 选人时优先展示 `name + email`
4. 正式权限对象最终保存 `user_id`
5. email 只用于搜索、展示和人工确认，不作为长期主键

## 当前产品语义

### system 管理侧

- 创建或更新工作区时，`workspace admin` 必须通过身份目录搜索选择
- 界面按 email 搜索 Keycloak 用户
- 保存时系统会解析并保存该用户的 `user_id`
- 如果历史工作区配置数据仍未绑定正式 `user_id`，界面会提示管理员重新选择并保存

### 工作区设置

- `project creators` 通过身份目录搜索、多选和移除管理
- 保存时只提交 `user_id[]`
- 页面显示继续使用 `name + email`
- 如果历史 `project creators` 仍是旧 email / 旧字符串绑定，页面会提示管理员重新选择并保存

### 项目级治理

- project owner
- project admins
- membership
- join request

这些对象继续以 `user_id` 为权限真相，不回退成 email 主键。

## 不支持的流程

当前 MVP 不支持以下能力：

- 把尚未存在于 IdP 的邮箱直接设置为正式 `workspace admin`
- 把尚未存在于 IdP 的邮箱直接设置为正式 `project creator`
- 面向业务用户开放完整 Keycloak 用户列表

如果未来要支持“先配置邮箱，后绑定真实身份”，应单独设计明确的待绑定模型，而不是继续保存自由字符串。

## Keycloak 目录能力

当前目录能力只用于“搜索选人”：

- 输入 email 关键字
- 返回最小用户信息：
  - `user_id`
  - `email`
  - `name`

不提供完整用户列表页，也不允许前端直接调用 Keycloak Admin API。

## 术语

- `工作区配置记录`：system 管理侧保存的工作区清单与配置数据
- 不再把这份数据泛化称为 `registry`
