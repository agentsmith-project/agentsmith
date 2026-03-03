# Endpoints 改进实施计划

**创建时间**: 2026-03-03
**状态**: `draft`
**PM**: pm-lead
**目标**: P0+P1 范围 - 自定义端点、验证功能、价格配置、UI 改进

---

## 一、项目概述

### 1.1 目标

基于 9router 参考项目的 UX 设计，改进 AgentSmith Endpoints 模块，聚焦：

| 优先级 | 功能 | 业务价值 |
|--------|------|----------|
| **P0** | 自定义模型端点支持 | 支持 OpenAI/Anthropic 兼容接口 |
| **P0** | 端点验证功能 | Check 按钮验证 API 连通性 |
| **P0** | 价格配置功能 | 查看和编辑模型定价 |
| **P1** | UI 信息密度提升 | 更清晰的状态展示 |
| **P1** | 连接状态指示器 | 显示端点健康状态 |
| **P1** | Provider 分组展示 | 更清晰的组织方式 |

### 1.2 当前痛点

1. **创建麻烦** - 不知道填什么、Provider 选项混乱、容易填错
2. **排查困难** - 端点不工作时不知道是 Provider/凭据/配置问题
3. **批量操作难** - 多个端点时无法批量管理
4. **状态不透明** - 不知道哪些端点正常、哪些有问题

### 1.3 设计原则

- **Contract First** - 先定义数据模型和 API 合约
- **TDD** - 测试先行，单元 + E2E + Visual
- **设计系统唯一** - 不引入设计系统外的样式
- **URL 为真相源** - 参数必须校验
- **Token 门禁** - 权限点作为唯一门禁依据

---

## 二、架构设计

### 2.1 新增类型定义

```typescript
// lib/api/types/endpoints.ts

/**
 * 自定义端点协议类型
 */
export type CustomEndpointProtocol = 'openai_compatible' | 'anthropic_compatible';

/**
 * 自定义端点配置
 */
export interface CustomEndpointConfig {
  protocol: CustomEndpointProtocol;
  baseUrl: string;           // e.g., "https://api.openai.com/v1"
  modelName: string;         // e.g., "gpt-4o"
  capability: EndpointCapabilityType;
  credentialRef: string;
}

/**
 * 模型价格配置
 */
export interface ModelPricing {
  modelId: string;
  endpointId: string;
  currency: 'USD' | 'CNY' | 'EUR';
  inputTokenPrice: number;   // per 1M tokens
  outputTokenPrice: number;  // per 1M tokens
  unit: 'million' | 'thousand';
  updatedAt?: string;
}

/**
 * 端点健康检查结果
 */
export interface EndpointHealthCheck {
  endpointId: string;
  status: 'pass' | 'fail' | 'unknown';
  checkedAt: string;         // ISO timestamp
  latencyMs?: number;
  error?: string;
  errorCategory?: 'auth' | 'network' | 'upstream' | 'timeout' | 'unknown';
}

/**
 * 批量健康检查请求
 */
export interface BatchHealthCheckRequest {
  endpointIds?: string[];
  mode?: 'all' | 'selected';
}

/**
 * 批量健康检查响应
 */
export interface BatchHealthCheckResponse {
  results: EndpointHealthCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}
```

### 2.2 API 合约更新

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/projects/{id}/endpoints/validate` | 验证端点连通性 |
| `GET` | `/projects/{id}/endpoints/{endpointId}/health` | 获取端点健康状态 |
| `POST` | `/projects/{id}/endpoints:health-batch` | 批量健康检查 |
| `GET` | `/projects/{id}/endpoints/{endpointId}/pricing` | 获取价格配置 |
| `PUT` | `/projects/{id}/endpoints/{endpointId}/pricing` | 更新价格配置 |

### 2.3 组件架构

```
components/endpoints/
├── EndpointsPage.tsx              # 主页面（协调器）
├── CreateEndpointDialog.tsx       # 创建对话框（已有，需增强）
├── EditEndpointDialog.tsx         # 编辑对话框（已有，需增强）
├── CustomEndpointWizard.tsx       # 新增：自定义端点创建向导
├── PricingConfigDialog.tsx        # 新增：价格配置对话框
├── EndpointStatusBadge.tsx        # 新增：状态徽章组件
├── ProviderLogo.tsx               # 新增：Provider Logo 组件
└── __tests__/
    ├── CustomEndpointWizard.test.tsx
    ├── PricingConfigDialog.test.tsx
    └── EndpointStatusBadge.test.tsx

lib/endpoints/
├── types.ts                       # 类型定义（已有，需扩展）
├── use-endpoints-data.ts          # 数据查询 hooks（已有，需扩展）
├── use-endpoints-mutations.ts     # 变更 hooks（已有，需扩展）
├── use-endpoint-health.ts         # 新增：健康检查 hook
├── use-endpoint-pricing.ts        # 新增：价格配置 hook
├── error-categorizer.ts           # 新增：错误分类工具
└── __tests__/
    ├── use-endpoint-health.test.ts
    ├── use-endpoint-pricing.test.ts
    └── error-categorizer.test.ts
```

---

## 三、任务分解与 Gates

### Task #2: Dev1 - API 类型与合约更新

**负责人**: Dev1
**工期**: 1-2 天
**依赖**: 无

#### 实施范围

1. **新增类型定义** (`lib/api/types/endpoints.ts`)
   - `CustomEndpointProtocol`
   - `CustomEndpointConfig`
   - `ModelPricing`
   - `EndpointHealthCheck`
   - `BatchHealthCheckRequest`
   - `BatchHealthCheckResponse`

2. **更新现有类型**
   - `CreateEndpointRequest` 支持 `custom` provider_family
   - `Endpoint` 类型增加可选的 `healthCheck` 和 `pricing` 字段

3. **API 客户端更新** (`lib/api/endpoints/`)
   - 新增 `validateEndpoint()` 方法
   - 新增 `getEndpointHealth()` 方法
   - 新增 `batchHealthCheck()` 方法
   - 新增 `getPricing()` / `updatePricing()` 方法

4. **Provider Catalog 扩展**
   - 增加 `custom` 类型的默认配置
   - OpenAI Compatible 默认 baseUrl
   - Anthropic Compatible 默认 baseUrl

#### Gate 验收标准

| Gate | 命令 | 预期结果 |
|------|------|----------|
| Type Check | `npx tsc --noEmit` | 无类型错误 |
| Contract Check | `npm run contracts:check` | 通过 |
| OpenAPI Check | `npm run contracts:check-openapi` | 与后端 schema 对齐 |
| Generated Check | `npm run openapi:check-generated` | 生成的客户端最新 |

#### 测试要求

```typescript
// lib/endpoints/__tests__/endpoint-api.test.ts
describe('Endpoint API', () => {
  it('should validate endpoint connectivity', async () => {
    const result = await endpointAPI.validate(workspaceId, projectId, {
      baseUrl: 'https://api.openai.com/v1',
      credentialRef: 'cred-123',
    });
    expect(result.status).toBe('pass' || 'fail');
  });

  it('should get endpoint health status', async () => {
    const health = await endpointAPI.getHealth(workspaceId, projectId, endpointId);
    expect(health).toHaveProperty('status');
    expect(health).toHaveProperty('checkedAt');
  });
});
```

---

### Task #4: Dev3 - 自定义端点创建流程

**负责人**: Dev3
**工期**: 3-4 天
**依赖**: Task #2

#### 实施范围

1. **CustomEndpointWizard 组件** (`components/endpoints/CustomEndpointWizard.tsx`)

   参考 9router 的 `AddOpenAICompatibleModal`，采用向导式三步流程：

   **Step 1 - 基本信息**
   - 端点名称输入
   - Provider 类型选择：OpenAI Compatible / Anthropic Compatible
   - Base URL 输入（带默认值和格式提示）

   **Step 2 - 模型配置**
   - 模型 ID 输入（支持手动输入或从 catalog 选择）
   - 能力类型选择：Chat/Multimodal/Embedding/Rerank
   - 凭据选择下拉框

   **Step 3 - 验证并创建**
   - Check 按钮：调用验证 API
   - 显示验证结果（绿色✓/红色✗ + 延迟）
   - Create 按钮（验证通过前禁用）

2. **表单验证逻辑**
   - Base URL 格式验证（必须以 /v1 或 / 结尾）
   - 模型 ID 非空验证
   - 凭据必选验证

3. **错误处理**
   - 验证失败时显示具体错误分类
   - 创建失败时显示友好错误信息

4. **i18n 支持**
   - 新增 `endpoints.custom_wizard.*` keys

#### Gate 验收标准

| Gate | 说明 | 验证方式 |
|------|------|----------|
| Unit Tests | 表单验证逻辑覆盖 | `npm test -- CustomEndpointWizard` |
| E2E Tests | 完整创建流程 | `npm run test:e2e -- endpoints-custom-create` |
| MSW Coverage | API 成功/失败场景 | mock 验证 |
| Type Safety | 无 `any` 类型 | `npx tsc --noEmit` |
| i18n Check | 所有文案国际化 | `npm run lint` |

#### 测试用例

```typescript
// components/endpoints/__tests__/CustomEndpointWizard.test.tsx
describe('CustomEndpointWizard', () => {
  it('should validate base URL format', () => {
    // 测试 /v1 结尾验证
    // 测试 https:// 协议验证
  });

  it('should disable create button when validation fails', () => {
    // 测试验证失败时按钮状态
  });

  it('should show success message after creation', () => {
    // 测试创建成功反馈
  });

  it('should handle validation errors correctly', () => {
    // 测试 AUTH/NETWORK/TIMEOUT 错误显示
  });
});
```

#### E2E 测试

```typescript
// e2e/endpoints/custom-endpoint.spec.ts
test('custom endpoint creation flow', async ({ page }) => {
  // 1. 导航到 endpoints 页面
  // 2. 点击 "Create" -> 选择 "Custom Endpoint"
  // 3. 填写基本信息
  // 4. 配置模型
  // 5. 点击 Check 验证
  // 6. 确认验证成功后点击 Create
  // 7. 验证端点出现在列表中
});
```

---

### Task #3: Dev4 - 价格配置功能

**负责人**: Dev4
**工期**: 2-3 天
**依赖**: Task #2

#### 实施范围

1. **PricingConfigDialog 组件** (`components/endpoints/PricingConfigDialog.tsx`)

   使用 Sheet (侧边抽屉) 布局：

   ```
   ┌─────────────────────────────────────┐
   │ Configure Pricing              [X] │
   ├─────────────────────────────────────┤
   │ Endpoint: gpt-4o (prod)            │
   ├─────────────────────────────────────┤
   │ Currency      [USD ▼]               │
   │ Input Price   [0.005] per 1M tokens │
   │ Output Price  [0.015] per 1M tokens │
   │                                      │
   │ Last updated: 2025-03-01            │
   ├─────────────────────────────────────┤
   │            [Cancel]  [Save]         │
   └─────────────────────────────────────┘
   ```

2. **useEndpointPricing Hook** (`lib/endpoints/use-endpoint-pricing.ts`)

   ```typescript
   interface UseEndpointPricingOptions {
     workspaceId: string;
     projectId: string;
     endpointId: string;
   }

   interface UseEndpointPricingReturn {
     pricing: ModelPricing | null;
     isLoading: boolean;
     error: Error | null;
     updatePricing: (data: Partial<ModelPricing>) => Promise<void>;
     invalidate: () => void;
   }
   ```

3. **表格集成**
   - 新增 "Pricing" 列
   - 点击显示价格预览（如 "$0.005/1M in"）
   - 点击后打开配置对话框

4. **复用现有资源**
   - Dev4 已有的 API hooks
   - 设计系统的 Input/Select 组件

#### Gate 验收标准

| Gate | 说明 | 验证方式 |
|------|------|----------|
| Unit Tests | 价格计算、格式化逻辑 | `npm test -- use-endpoint-pricing` |
| E2E Tests | 编辑价格流程 | `npm run test:e2e -- endpoints-pricing` |
| Type Safety | 价格字段类型安全 | `npx tsc --noEmit` |
| Permission Gate | 只有 manage 权限可编辑 | 权限测试 |

#### 测试用例

```typescript
// lib/endpoints/__tests__/use-endpoint-pricing.test.ts
describe('useEndpointPricing', () => {
  it('should fetch pricing data', async () => {
    // 测试获取价格
  });

  it('should update pricing', async () => {
    // 测试更新价格
  });

  it('should format price display', () => {
    // 测试价格格式化: 0.005 -> "$0.005/1M"
  });
});
```

#### E2E 测试

```typescript
// e2e/endpoints/pricing.spec.ts
test('pricing configuration flow', async ({ page }) => {
  // 1. 导航到 endpoints 页面
  // 2. 点击某端点的 "Pricing" 列
  // 3. 验证对话框打开并显示当前价格
  // 4. 修改价格
  // 5. 点击 Save
  // 6. 验证价格已更新
  // 7. 验证无权限用户无法编辑
});
```

---

### Task #5: Dev2 - Endpoints 列表页 UI 改进

**负责人**: Dev2
**工期**: 3-4 天
**依赖**: Task #2, Task #3, Task #4

#### 实施范围

1. **新增组件**

   **EndpointStatusBadge** (`components/endpoints/EndpointStatusBadge.tsx`)
   ```typescript
   interface EndpointStatusBadgeProps {
     status: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
     lastCheck?: string;
     errorCategory?: string;
   }
   ```
   - 绿色徽章 + 点: healthy
   - 黄色徽章 + 点: degraded
   - 红色徽章 + 点: unavailable
   - 灰色徽章: unknown

   **ProviderLogo** (`components/endpoints/ProviderLogo.tsx`)
   ```typescript
   interface ProviderLogoProps {
     provider: string;
     size?: 'sm' | 'md' | 'lg';
   }
   ```
   - 32x32 图标
   - 品牌色背景
   - Fallback 文字图标

   **ErrorTag** (`components/endpoints/ErrorTag.tsx`)
   ```typescript
   interface ErrorTagProps {
     category: 'auth' | 'rate_limit' | 'upstream' | 'network' | 'timeout';
   }
   ```
   - AUTH (红色)
   - 429 (黄色)
   - 5XX (橙色)
   - NET (紫色)
   - TIMEOUT (灰色)

2. **表格列优化**

   | 列 | 说明 | 组件 |
   |---|---|---|---|
   | Provider | Logo + 名称 | ProviderLogo |
   | Name/Model | 端点名 + 模型 | Link |
   | Capability | Badge | Badge |
   | Status | 健康状态 | EndpointStatusBadge |
   | Last Check | 相对时间 | Text |
   | Pricing | 价格预览 | Text |
   | Actions | 编辑/删除/测试 | Button 组 |

3. **Provider 分组视图（可选增强）**
   - 新增视图切换按钮（表格/分组）
   - 分组视图按 `provider_family` 分组
   - 每组显示统计：总数、健康数、异常数

4. **空状态优化**
   - 全健康时：绿色徽章 "All systems operational"
   - 有异常时：红色警告 "X endpoints need attention"

#### Gate 验收标准

| Gate | 说明 | 验证方式 |
|------|------|----------|
| Visual E2E | 徽章样式符合设计系统 | `npm run test:e2e -- visual` |
| E2E Tests | 状态变化正确反映 | `npm run test:e2e -- endpoints-status` |
| Responsive | 移动端表格不溢出 | `npm run test:e2e -- endpoints-responsive` |
| Accessibility | 颜色对比度符合 WCAG | `npm run lint` |

#### 测试用例

```typescript
// components/endpoints/__tests__/EndpointStatusBadge.test.tsx
describe('EndpointStatusBadge', () => {
  it('should display healthy status with green color', () => {
    // 测试健康状态
  });

  it('should display error category tag', () => {
    // 测试错误分类标签
  });

  it('should show relative time for last check', () => {
    // 测试相对时间显示
  });
});
```

#### Visual E2E

```typescript
// e2e/visual/endpoints.spec.ts
test('endpoints page visual regression', async ({ page }) => {
  // 截图对比：不同状态下的表格显示
  // - 全健康状态
  // - 混合健康状态
  // - 异常状态（带错误标签）
});
```

---

### Task #6: 最终验收与收口检查

**负责人**: PM + QA
**工期**: 1 天
**依赖**: Task #2, #3, #4, #5

#### 验收清单

| 类别 | 检查项 | 状态 |
|------|--------|------|
| **类型安全** | `npx tsc --noEmit` 无错误 | ⬜ |
| **合约检查** | `npm run contracts:check` 通过 | ⬜ |
| **单元测试** | 所有组件 hook 测试通过 | ⬜ |
| **E2E 测试** | 端到端流程测试通过 | ⬜ |
| **Visual E2E** | UI 截图对比通过 | ⬜ |
| **i18n** | 所有文案国际化 | ⬜ |
| **权限** | 门禁正确执行 | ⬜ |
| **文档** | 更新相关文档 | ⬜ |

#### Release Gate

运行完整的 gate 检查：
```bash
npm run contracts:check && \
npm run contracts:check-openapi && \
npm run openapi:check-generated && \
npm test && \
npm run lint && \
npx tsc --noEmit && \
npm run test:e2e
```

---

## 四、依赖关系与并行策略

```
                    ┌─────────────┐
                    │   Task #2   │
                    │ (Dev1: API) │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     ┌───────────┐  ┌───────────┐  ┌───────────┐
     │ Task #3   │  │ Task #4   │  │ Task #5   │
     │ (Dev4)    │  │ (Dev3)    │  │ (Dev2)    │
     │ Pricing   │  │ Custom    │  │ UI        │
     └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
           │             │             │
           └──────────────┼─────────────┘
                          ▼
                   ┌─────────────┐
                   │   Task #6   │
                   │ (Final Gate)│
                   └─────────────┘
```

**并行开发建议**：
1. Dev1 先完成 Task #2（API 合约）
2. Task #2 完成后，Dev3、Dev4、Dev2 并行开发
3. PM 持续跟踪进度，协调依赖

---

## 五、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 后端 API 未就绪 | 阻塞开发 | 使用 MSW mock，先开发前端 |
| 设计系统组件不足 | UI 不一致 | 复用现有组件，必要时新增 |
| 9router 设计不完全适用 | 需求理解偏差 | PM 及时澄清范围，聚焦 P0+P1 |
| 测试覆盖不足 | 质量风险 | TDD 强制要求，Gate 检查 |

---

## 六、参考资源

### 6.1 参考项目
- `/home/percy/works/mbos-v1/for-reference-only/9router/src/app/(dashboard)/dashboard/endpoint/`
- `/home/percy/works/mbos-v1/for-reference-only/9router/src/app/(dashboard)/dashboard/providers/`

### 6.2 当前实现
- `/home/percy/works/mbos-v1/agentsmith/src/components/endpoints/`
- `/home/percy/works/mbos-v1/agentsmith/src/lib/endpoints/`

### 6.3 必读文档
- `/home/percy/works/mbos-v1/agentsmith/docs/项目宪法.md`
- `/home/percy/works/mbos-v1/agentsmith/docs/design/agentsmith-product-engineering-governance-methodology-v1.md`
- `/home/percy/works/mbos-v1/agentsmith/DESIGN_SYSTEM.md`

---

## 七、修订历史

| 版本 | 日期 | 变更说明 |
|------|------|----------|
| v0.1 | 2026-03-03 | 初版，基于 P0+P1 范围 |

---

**文档状态**: 待团队 review
**下一步**: PM 确认后，开发团队开始执行
