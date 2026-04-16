import { useState, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { CreateAgentDialog } from "../CreateAgentDialog";
import { EditAgentDialog } from "../EditAgentDialog";
import {
  INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
  INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
} from "@mbos/contracts";

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockEndpointList = vi.fn();

const mockMessages = {
  agents: {
    create_dialog: {
      title: "Create Agent",
      description: "Description",
      name: "Name",
      name_placeholder: "Agent name",
      mode: "Mode",
      mode_external: "External",
      mode_internal: "Internal",
      config_title: "Internal Agent Config",
      image: "Image",
      image_required: "Image required",
      env: "Environment Variables",
      add_env: "Add variable",
      max_concurrent_sessions: "Max Concurrent Sessions",
      max_concurrent_sessions_placeholder: "Optional override",
      cpu_request: "CPU Request",
      cpu_limit: "CPU Limit",
      memory_request: "Memory Request",
      memory_limit: "Memory Limit",
      idle_timeout_sec: "Idle Timeout (sec)",
      max_lifetime_sec: "Max Lifetime (sec)",
      capabilities_title: "Execution Capabilities",
      chat_endpoint_id: "Chat Endpoint",
      chat_endpoint_required: "Select a chat endpoint",
      chat_endpoint_empty: "No active chat endpoints available",
      notebook_endpoint_id: "Notebook Endpoint",
      notebook_endpoint_required: "Select a notebook endpoint",
      notebook_endpoint_empty: "No active endpoints available",
      multimodal_enabled: "Enable multimodal input",
      accepted_mime_types: "Accepted MIME types",
      max_file_count: "Max files per message",
      max_total_bytes: "Max total bytes per message",
      success: "Created",
    },
    edit_dialog: {
      title: "Edit Agent",
      description: "Update agent",
      success: "Updated",
    },
    interaction_chat: "Chat",
    interaction_notebook: "Notebook",
    agent_kind: "Agent kind",
    execution_target: "Execution target",
    execution_target_chat_help: "Choose the endpoint this chat agent will use for inference.",
    execution_target_notebook_help: "Choose the endpoint this notebook agent will use for task execution.",
    product_step_description: "Define the agent surface first, then configure deployment details.",
    deployment_step_description: "Set image, limits, and environment after the product shape is clear.",
    back_to_product_setup: "Back to product setup",
  },
  common: {
    cancel: "Cancel",
    create: "Create",
    next: "Next",
    save: "Save",
    private: "Private",
    public: "Public",
    visibility: "Visibility",
    placeholders: {
      enter_description: "Enter description",
    },
  },
};

function resolveTranslation(path: string): string {
  const keys = path.split(".");
  let current: unknown = mockMessages;
  for (const key of keys) {
    if (!current || typeof current !== "object" || !(key in current))
      return path;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : path;
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    resolveTranslation(`${namespace}.${key}`),
  useLocale: () => "en-US",
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/lib/api", () => ({
  getApiClient: vi.fn(() => ({ request: vi.fn() })),
  AgentAPI: class {
    create = mockCreate;
    update = mockUpdate;
  },
  EndpointAPI: class {
    list = mockEndpointList;
  },
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/settings/ExecutionPreferencesEditor", () => ({
  ExecutionPreferencesEditor: () => (
    <div data-testid="execution-preferences-editor" />
  ),
}));

function renderWithProviders(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en-US" messages={mockMessages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

type OpenChangeSpy = ReturnType<typeof vi.fn>;

function renderControlledDialog(
  renderDialog: (props: { open: boolean; onOpenChange: (next: boolean) => void }) => ReactNode,
) {
  const onOpenChange = vi.fn();

  function ControlledDialog() {
    const [open, setOpen] = useState(true);

    const handleOpenChange = (next: boolean) => {
      onOpenChange(next);
      setOpen(next);
    };

    return <>{renderDialog({ open, onOpenChange: handleOpenChange })}</>;
  }

  renderWithProviders(<ControlledDialog />);
  return { onOpenChange };
}

function renderCreateDialog() {
  return renderControlledDialog(({ open, onOpenChange }) => (
    <CreateAgentDialog
      open={open}
      onOpenChange={onOpenChange}
      workspaceId="ws_1"
      projectId="proj_1"
    />
  ));
}

function renderEditDialog(agent: unknown) {
  return renderControlledDialog(({ open, onOpenChange }) => (
    <EditAgentDialog
      open={open}
      onOpenChange={onOpenChange}
      workspaceId="ws_1"
      projectId="proj_1"
      agent={agent as any}
      canSetVisibility={false}
    />
  ));
}

async function expectDialogClosed(testId: string, onOpenChange: OpenChangeSpy) {
  await waitFor(() => {
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  await waitFor(() => {
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
  });
}

async function closeDialog(testId: string, onOpenChange: OpenChangeSpy) {
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await expectDialogClosed(testId, onOpenChange);
}

describe("Agent dialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "ag_1" });
    mockUpdate.mockResolvedValue({ id: "ag_1" });
    mockEndpointList.mockResolvedValue({
      items: [
        {
          id: "ep_active_1",
          name: "OpenAI Main",
          model: "gpt-4.1",
          provider_family: "openai",
          status: "active",
        },
        {
          id: "ep_disabled",
          name: "Disabled",
          model: "gpt-4o-mini",
          provider_family: "openai",
          status: "disabled",
        },
      ],
    });
  });

  it("CreateAgentDialog defaults to chat and submits chat execution preferences", async () => {
    const { onOpenChange } = renderCreateDialog();

    const nameInput = await screen.findByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "agent-a" } });

    const endpointSelect = screen.getByLabelText(
      "Execution target",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(endpointSelect.value).toBe("ep_active_1");
    });

    expect(
      screen.getByText("OpenAI Main (openai/gpt-4.1)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Disabled (openai/gpt-4o-mini)"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(
        screen.getByTestId("agents__create-dialog__product-summary"),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });
    await expectDialogClosed("agents__create-dialog", onOpenChange);
    const payload = mockCreate.mock.calls[0][2];
    expect(payload.interaction_kind).toBe("chat");
    expect(payload.execution_preferences?.chat?.endpoint_id).toBe(
      "ep_active_1",
    );
    expect(payload.execution_preferences?.chat?.executor).toBe(
      "llm_passthrough",
    );
    expect(payload.execution_preferences?.chat?.wire_api).toBe("chat");
    expect(payload.execution_preferences?.notebook).toBeUndefined();
  });

  it("CreateAgentDialog switches to notebook and submits notebook execution preferences", async () => {
    const { onOpenChange } = renderCreateDialog();

    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "agent-notebook" },
    });
    fireEvent.change(
      document.getElementById("agent-interaction-kind") as HTMLSelectElement,
      { target: { value: "notebook" } },
    );

    const endpointSelect = screen.getByLabelText(
      "Execution target",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(endpointSelect.value).toBe("ep_active_1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(
        screen.getByTestId("agents__create-dialog__product-summary"),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });
    await expectDialogClosed("agents__create-dialog", onOpenChange);

    const payload = mockCreate.mock.calls[0][2];
    expect(payload.interaction_kind).toBe("notebook");
    expect(payload.execution_preferences?.notebook?.endpoint_id).toBe(
      "ep_active_1",
    );
    expect(payload.execution_preferences?.notebook?.executor).toBe("codex_cli");
    expect(payload.execution_preferences?.chat).toBeUndefined();
  });

  it("EditAgentDialog submits updated internal env and notebook endpoint selection", async () => {
    const internalAgent = {
      id: "ag_internal_1",
      name: "Internal Agent",
      description: "",
      mode: "internal",
      status: "enabled",
      interaction_kind: "notebook",
      execution_preferences_json: {
        notebook: {
          endpoint_id: "ep_active_1",
        },
      },
      config: {
        image: "ghcr.io/example/runner:latest",
        env: {
          FOO: "bar",
        },
      },
      created_at: "2026-03-04T00:00:00.000Z",
      updated_at: "2026-03-04T00:00:00.000Z",
    };

    const { onOpenChange } = renderEditDialog(internalAgent);

    const endpointSelect = await waitFor(() => {
      const candidate = screen
        .getAllByRole("combobox")
        .find(
          (element) =>
            element.querySelector('option[value="ep_active_1"]') !== null,
        );
      expect(candidate).toBeDefined();
      return candidate as HTMLSelectElement;
    });
    fireEvent.change(endpointSelect, { target: { value: "ep_active_1" } });

    const keyInputs = screen.getAllByPlaceholderText("KEY");
    const valueInputs = screen.getAllByPlaceholderText("value");
    fireEvent.change(keyInputs[0], { target: { value: "FOO" } });
    fireEvent.change(valueInputs[0], { target: { value: "baz" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
    });
    await expectDialogClosed("agents__edit-dialog", onOpenChange);
    const payload = mockUpdate.mock.calls[0][3];
    expect(payload.config.env).toEqual({ FOO: "baz" });
    expect(payload.interaction_kind).toBe("notebook");
    expect(payload.execution_preferences.notebook.endpoint_id).toBe(
      "ep_active_1",
    );
    expect(payload.execution_preferences.notebook.executor).toBe("codex_cli");
  });

  it("EditAgentDialog switches an external agent to chat and updates chat endpoint selection", async () => {
    const externalAgent = {
      id: "ag_external_1",
      name: "External Agent",
      description: "",
      mode: "external",
      status: "enabled",
      interaction_kind: "notebook",
      execution_preferences_json: {
        notebook: {
          endpoint_id: "ep_active_1",
        },
      },
      created_at: "2026-03-04T00:00:00.000Z",
      updated_at: "2026-03-04T00:00:00.000Z",
    };

    const { onOpenChange } = renderEditDialog(externalAgent);

    await waitFor(() => {
      expect(
        screen.getByText("OpenAI Main (openai/gpt-4.1)"),
      ).toBeInTheDocument();
    });
    fireEvent.change(
      document.getElementById(
        "edit-agent-interaction-kind",
      ) as HTMLSelectElement,
      { target: { value: "chat" } },
    );
    const endpointSelect = screen.getByLabelText(
      "Execution target",
    ) as HTMLSelectElement;
    fireEvent.change(endpointSelect, { target: { value: "ep_active_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
    });
    await expectDialogClosed("agents__edit-dialog", onOpenChange);

    const payload = mockUpdate.mock.calls[0][3];
    expect(payload.interaction_kind).toBe("chat");
    expect(payload.execution_preferences.chat.endpoint_id).toBe("ep_active_1");
    expect(payload.execution_preferences.chat.executor).toBe("llm_passthrough");
    expect(payload.execution_preferences.notebook).toBeUndefined();
  });

  it("CreateAgentDialog uses the normalized internal sandbox defaults", async () => {
    const { onOpenChange } = renderCreateDialog();

    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "agent-internal" },
    });
    fireEvent.click(await screen.findByLabelText("Internal"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(
        screen.getByTestId("agents__create-dialog__product-summary"),
      ).toBeInTheDocument();
    });

    const idleTimeoutInput = screen.getByLabelText(
      "Idle Timeout (sec)",
    ) as HTMLInputElement;
    const maxLifetimeInput = screen.getByLabelText(
      "Max Lifetime (sec)",
    ) as HTMLInputElement;

    expect(idleTimeoutInput.value).toBe(
      String(INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS),
    );
    expect(idleTimeoutInput.min).toBe(
      String(INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS),
    );
    expect(maxLifetimeInput.value).toBe(
      String(INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS),
    );
    await closeDialog("agents__create-dialog", onOpenChange);
  });

  it("CreateAgentDialog does not submit while advancing from product to deployment", async () => {
    const { onOpenChange } = renderCreateDialog();

    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "agent-transition-check" },
    });

    const endpointSelect = screen.getByLabelText(
      "Execution target",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(endpointSelect.value).toBe("ep_active_1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(
        screen.getByTestId("agents__create-dialog__product-summary"),
      ).toBeInTheDocument();
    });
    expect(mockCreate).not.toHaveBeenCalled();
    await closeDialog("agents__create-dialog", onOpenChange);
  });

  it("CreateAgentDialog updates endpoint wording when switching agent type", async () => {
    const { onOpenChange } = renderCreateDialog();

    expect(await screen.findByLabelText("Execution target")).toBeInTheDocument();
    expect(
      screen.getByText("Choose the endpoint this chat agent will use for inference."),
    ).toBeInTheDocument();

    fireEvent.change(
      document.getElementById("agent-interaction-kind") as HTMLSelectElement,
      { target: { value: "notebook" } },
    );

    expect(screen.getByLabelText("Execution target")).toBeInTheDocument();
    expect(
      screen.getByText("Choose the endpoint this notebook agent will use for task execution."),
    ).toBeInTheDocument();
    await closeDialog("agents__create-dialog", onOpenChange);
  });
});
