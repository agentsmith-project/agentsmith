#!/usr/bin/env bash

k8s_external_postgres_service_name() {
  printf '%s' "${INTERNAL_AGENT_EXTERNAL_POSTGRES_SERVICE_NAME:-postgres-external}"
}

k8s_external_minio_service_name() {
  printf '%s' "${INTERNAL_AGENT_EXTERNAL_MINIO_SERVICE_NAME:-minio-external}"
}

k8s_service_fqdn() {
  local service_name="$1"
  local namespace="$2"
  printf '%s.%s.svc.cluster.local' "${service_name}" "${namespace}"
}

k8s_external_postgres_fqdn() {
  local namespace="$1"
  k8s_service_fqdn "$(k8s_external_postgres_service_name)" "${namespace}"
}

k8s_external_minio_fqdn() {
  local namespace="$1"
  k8s_service_fqdn "$(k8s_external_minio_service_name)" "${namespace}"
}

ensure_container_on_network() {
  local network_name="$1"
  local container_name="$2"
  docker network connect "${network_name}" "${container_name}" >/dev/null 2>&1 || true
}

kind_cluster_node_names() {
  local cluster_name="${1:-agentsmith}"
  docker ps \
    --filter "label=io.x-k8s.kind.cluster=${cluster_name}" \
    --format '{{.Names}}'
}

ensure_kind_nodes_on_network() {
  local network_name="$1"
  local cluster_name="${2:-agentsmith}"
  local node_name
  while read -r node_name; do
    [[ -n "${node_name}" ]] || continue
    ensure_container_on_network "${network_name}" "${node_name}"
  done < <(kind_cluster_node_names "${cluster_name}")
}

resolve_container_network_ip() {
  local network_name="$1"
  local container_name="$2"
  docker inspect "${container_name}" \
    -f "{{with index .NetworkSettings.Networks \"${network_name}\"}}{{.IPAddress}}{{end}}" 2>/dev/null \
    | awk 'NF { print; exit }'
}

is_ipv4_address() {
  local value="$1"
  [[ "${value}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

render_k8s_external_dependency_services() {
  local output_path="$1"
  local namespace="$2"
  local postgres_target_ip="$3"
  local postgres_target_port="$4"
  local minio_target_ip="$5"
  local minio_target_port="$6"
  local postgres_service_name
  local minio_service_name

  postgres_service_name="$(k8s_external_postgres_service_name)"
  minio_service_name="$(k8s_external_minio_service_name)"

  cat > "${output_path}" <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${postgres_service_name}
  namespace: ${namespace}
  labels:
    app.kubernetes.io/managed-by: agentsmith
spec:
  ports:
    - name: postgres
      port: 5432
      protocol: TCP
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: ${postgres_service_name}-external
  namespace: ${namespace}
  labels:
    kubernetes.io/service-name: ${postgres_service_name}
    app.kubernetes.io/managed-by: agentsmith
addressType: IPv4
ports:
  - name: postgres
    protocol: TCP
    port: ${postgres_target_port}
endpoints:
  - addresses:
      - ${postgres_target_ip}
---
apiVersion: v1
kind: Service
metadata:
  name: ${minio_service_name}
  namespace: ${namespace}
  labels:
    app.kubernetes.io/managed-by: agentsmith
spec:
  ports:
    - name: http
      port: 9000
      protocol: TCP
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: ${minio_service_name}-external
  namespace: ${namespace}
  labels:
    kubernetes.io/service-name: ${minio_service_name}
    app.kubernetes.io/managed-by: agentsmith
addressType: IPv4
ports:
  - name: http
    protocol: TCP
    port: ${minio_target_port}
endpoints:
  - addresses:
      - ${minio_target_ip}
EOF
}
