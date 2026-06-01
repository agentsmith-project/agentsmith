import type { ProductVerificationFlowId } from '../unified-deploy/check-verification-report';

export const POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION =
  'agentsmith.post-deploy-product-smoke-report/v1' as const;
export const POST_DEPLOY_PRODUCT_SMOKE_PRODUCER =
  'agentsmith-post-deploy-product-smoke' as const;
export const POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME =
  'post-deploy-product-smoke-report.json' as const;
export const AGENTSMITH_POST_DEPLOY_PRODUCT_SMOKE_REPO =
  'github.com/agentsmith-project/agentsmith' as const;

export type PostDeployProductSmokeId =
  | Exclude<ProductVerificationFlowId, 'chat_via_llmup'>
  | 'provider_neutral_endpoint';

type ProductSmokeSpec = {
  id: PostDeployProductSmokeId;
  source_flow: ProductVerificationFlowId;
  label: string;
};

export const POST_DEPLOY_PRODUCT_SMOKE_SPECS: readonly ProductSmokeSpec[] = [
  { id: 'login_profile', source_flow: 'login_profile', label: 'login/profile' },
  { id: 'workspace_project', source_flow: 'workspace_project', label: 'workspace/project' },
  {
    id: 'provider_neutral_endpoint',
    source_flow: 'chat_via_llmup',
    label: 'provider-neutral Endpoint',
  },
  {
    id: 'agent_task_managed_runner',
    source_flow: 'agent_task_managed_runner',
    label: 'Agent task managed runner',
  },
  { id: 'files', source_flow: 'files', label: 'Files' },
  { id: 'audit', source_flow: 'audit', label: 'audit' },
  { id: 'usage', source_flow: 'usage', label: 'usage' },
] as const;
