import { describe, expect, it } from "vitest";

import { migrateLegacyType, migrateLegacyUpstreamProtocol } from "./backfill-upstream-protocol-utils";

describe("endpoint backfill migration helpers", () => {
  it("maps legacy openai compatible records to chat completions", () => {
    expect(migrateLegacyUpstreamProtocol({ protocol: "openai_compatible" })).toBe("openai_chat_completions");
  });

  it("maps legacy anthropic compatible records to anthropic messages", () => {
    expect(migrateLegacyUpstreamProtocol({ protocol: "anthropic_compatible" })).toBe("anthropic_messages");
  });

  it("keeps canonical records unchanged and derives catalog type by default", () => {
    expect(migrateLegacyUpstreamProtocol({ upstream_protocol: "openai_responses" })).toBe("openai_responses");
    expect(migrateLegacyType({ type: "catalog" })).toBe("catalog");
  });
});
