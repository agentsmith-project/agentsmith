export const ASBCP_LEGACY_RESIDUE_NEGATIVE_EVIDENCE_REASON = 'allow-asbcp-legacy-residue-negative-evidence';

export const LEGACY_ASBCP_KUBERNETES_IDENTITY = 'agentsmith-sandbox-manager'; // allow-asbcp-legacy-residue-negative-evidence
export const LEGACY_ASBCP_COMPONENT_NAME = 'sandbox-manager'; // allow-asbcp-legacy-residue-negative-evidence
export const LEGACY_ASBCP_CHECKSUM_FRAGMENT = 'checksum-sandbox-manager'; // allow-asbcp-legacy-residue-negative-evidence

export const LEGACY_ASBCP_CONFIGMAP_NAME = `legacy-${LEGACY_ASBCP_COMPONENT_NAME}-config`;
export const LEGACY_ASBCP_LOCAL_KIND_PV_RBAC_NAME = `${LEGACY_ASBCP_KUBERNETES_IDENTITY}-pv`;

export const LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS = [
  `Deployment/${LEGACY_ASBCP_KUBERNETES_IDENTITY}`,
  `Service/${LEGACY_ASBCP_KUBERNETES_IDENTITY}`,
  `ConfigMap/${LEGACY_ASBCP_KUBERNETES_IDENTITY}`,
  `ServiceAccount/${LEGACY_ASBCP_KUBERNETES_IDENTITY}`,
  `Role/${LEGACY_ASBCP_KUBERNETES_IDENTITY}`,
  `RoleBinding/${LEGACY_ASBCP_KUBERNETES_IDENTITY}`,
] as const;

export const LEGACY_ASBCP_LOCAL_KIND_CLUSTER_RESOURCE_IDS = [
  `ClusterRole/${LEGACY_ASBCP_LOCAL_KIND_PV_RBAC_NAME}`,
  `ClusterRoleBinding/${LEGACY_ASBCP_LOCAL_KIND_PV_RBAC_NAME}`,
] as const;

export const LEGACY_ASBCP_RESIDUE_MATCHERS = [
  LEGACY_ASBCP_KUBERNETES_IDENTITY,
  LEGACY_ASBCP_COMPONENT_NAME,
  LEGACY_ASBCP_CHECKSUM_FRAGMENT,
  'sandbox_manager', // allow-asbcp-legacy-residue-negative-evidence
] as const;
