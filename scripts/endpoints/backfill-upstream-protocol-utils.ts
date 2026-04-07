export type CanonicalEndpointUpstreamProtocol =
  | "openai_chat_completions"
  | "openai_responses"
  | "anthropic_messages";

export type LegacyEndpointProtocol =
  | "openai_compatible"
  | "anthropic_compatible"
  | "openai_chat_completions"
  | "openai_responses"
  | "anthropic_messages"
  | "google_gemini"
  | "glm_native"
  | "dashscope_native";

export function migrateLegacyUpstreamProtocol(endpoint: {
  upstream_protocol?: string;
  protocol?: string;
}): CanonicalEndpointUpstreamProtocol {
  if (
    endpoint.upstream_protocol === "openai_chat_completions"
    || endpoint.upstream_protocol === "openai_responses"
    || endpoint.upstream_protocol === "anthropic_messages"
  ) {
    return endpoint.upstream_protocol;
  }

  switch (endpoint.protocol as LegacyEndpointProtocol | undefined) {
    case "anthropic_compatible":
    case "anthropic_messages":
      return "anthropic_messages";
    case "openai_responses":
      return "openai_responses";
    case "openai_chat_completions":
    case "google_gemini":
    case "glm_native":
    case "dashscope_native":
    case "openai_compatible":
    default:
      return "openai_chat_completions";
  }
}

export function migrateLegacyType(endpoint: { type?: string; provider_family?: string }): "catalog" | "custom" {
  if (endpoint.type === "catalog" || endpoint.type === "custom") return endpoint.type;
  if (endpoint.provider_family === "custom") return "custom";
  return "catalog";
}
