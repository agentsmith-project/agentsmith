import { describe, expect, it, vi } from "vitest";

import { buildEndpointsExportPayload } from "../endpoints-page-utils";

describe("buildEndpointsExportPayload", () => {
  it("exports canonical endpoint payload keys only", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00.000Z"));

    const payload = buildEndpointsExportPayload("ws_1", "proj_1", [
      {
        id: "ep_1",
        project_id: "proj_1",
        name: "OpenAI Main",
        description: "primary",
        model: "gpt-4o",
        type: "catalog",
        provider_family: "openai",
        upstream_protocol: "openai_chat_completions",
        capabilities: ["chat_completion"],
        models: { chat_model_id: "gpt-4o" },
        defaults: { temperature: 0.2 },
        base_url: "https://api.openai.com/v1",
        status: "active",
        credential_ref: "cred_1",
        limits: { timeout_seconds: 60 },
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
      },
    ] as any);

    expect(payload).toMatchObject({
      exported_at: "2026-04-07T12:00:00.000Z",
      workspace_id: "ws_1",
      project_id: "proj_1",
      bulk_import_template_examples: {
        completion: { mode: "openai" },
      },
    });
    expect(payload.endpoints[0]).toMatchObject({
      upstream_protocol: "openai_chat_completions",
      api_base: "https://api.openai.com/v1",
      credential_ref: "cred_1",
    });
    expect(Object.keys(payload)).toEqual(expect.not.arrayContaining([expect.stringMatching(/compatible_template/)]));

    vi.useRealTimers();
  });
});
