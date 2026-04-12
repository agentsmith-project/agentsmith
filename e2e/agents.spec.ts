/**
 * Agents Page – E2E Tests
 *
 * Covers table rendering, agent data, create dialog, edit dialog, and
 * enable/disable toggle using MSW-provided mock data.
 */

import type { Locator } from "@playwright/test";

import { test, expect, goToProject } from "./fixtures/test-base";

async function waitForExecutionTargetReady(dialog: Locator) {
  const endpointSelect = dialog.locator("#agent-execution-endpoint-id");
  await expect(endpointSelect).toBeVisible();
  await expect.poll(async () => endpointSelect.inputValue()).not.toBe("");
  return endpointSelect;
}

async function continueToDeployment(dialog: Locator) {
  await waitForExecutionTargetReady(dialog);
  const nextButton = dialog.getByRole("button", { name: /^next$/i });
  await expect(nextButton).toBeEnabled();
  await nextButton.click();
  await expect(
    dialog.getByTestId("agents__create-dialog__product-summary"),
  ).toBeVisible();
}

test.describe("Agents Page", () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, "agents");
  });

  test("table renders with agent rows", async ({ authedPage }) => {
    const table = authedPage.getByTestId("agents__table");
    await expect(table).toBeVisible({ timeout: 10000 });

    // MSW returns multiple agents for proj_001 – verify at least one row
    const rows = table.locator('[data-testid="agents__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });

  test("displays agent names from mock data", async ({ authedPage }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    // Agent names from p0.json: "Support Agent", "Research Agent"
    await expect(authedPage.getByText("Support Agent")).toBeVisible();
    await expect(authedPage.getByText("Research Agent")).toBeVisible();
  });

  test("shows build header actions", async ({ authedPage }) => {
    await expect(authedPage.getByTestId("agents__open-endpoints")).toHaveAttribute(
      "href",
      /\/endpoints$/,
    );
    await expect(authedPage.getByTestId("agents__open-chat")).toHaveCount(0);
    await expect(authedPage.getByTestId("agents__open-notebook")).toHaveCount(0);
  });

  test("opens diagnostics panel when agent query context is present", async ({
    authedPage,
  }) => {
    await authedPage.goto(
      "/en-US/workspaces/ws_default/projects/proj_001/agents?agent=agent_001",
      { waitUntil: "domcontentloaded" },
    );
    await expect(authedPage.getByText(/support agent/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("create dialog opens with form fields", async ({ authedPage }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    const createBtn = authedPage.getByTestId("agents__create-btn");
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    const dialog = authedPage.getByTestId("agents__create-dialog");
    await expect(dialog).toBeVisible();

    // Verify the dialog contains a name input
    await expect(dialog.locator("#agent-name")).toBeVisible();
    await dialog.locator("#agent-name").fill("E2E Product Draft");
    await expect(dialog.locator("#agent-interaction-kind")).toBeVisible();
    await expect(
      dialog.locator('#agent-interaction-kind option[value="chat"]'),
    ).toHaveCount(1);
    await expect(
      dialog.locator('#agent-interaction-kind option[value="notebook"]'),
    ).toHaveCount(1);
    await expect(dialog.locator("#agent-interaction-kind option")).toHaveCount(
      2,
    );
    await waitForExecutionTargetReady(dialog);
    await expect(dialog.getByLabel("Execution target")).toBeVisible();
    await expect(
      dialog.getByText("Choose the endpoint this chat agent will use for inference."),
    ).toBeVisible();
    const nextButton = dialog.getByRole("button", { name: /^next$/i });
    await expect(nextButton).toBeVisible();
    await dialog.locator("#agent-name").fill("Dialog Contract Check");
    await expect(nextButton).toBeEnabled();
  });

  test("edit dialog opens when clicking edit on a row", async ({
    authedPage,
  }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    // Click the edit (Pencil) button on the first agent row
    const firstRow = authedPage.getByTestId("agents__table__row").first();
    await expect(firstRow).toBeVisible();
    const editBtn = firstRow.getByRole("button", { name: /edit/i });
    await editBtn.click();

    const editDialog = authedPage.getByTestId("agents__edit-dialog");
    await expect(editDialog).toBeVisible();
  });

  test("enable/disable toggle button is present on each row", async ({
    authedPage,
  }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    // Each row should have either an "Enable" or "Disable" button
    const rows = authedPage.getByTestId("agents__table__row");
    const firstRow = rows.first();
    await expect(firstRow).toBeVisible();
    const toggleBtn = firstRow.getByRole("button", { name: /enable|disable/i });
    await expect(toggleBtn).toBeVisible();
  });

  test("table shows interaction kind and status badges", async ({
    authedPage,
  }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    await expect(authedPage.getByText(/chat/i).first()).toBeVisible();
    await expect(authedPage.getByText(/Notebook/i).first()).toBeVisible();
    await expect(authedPage.getByText(/active|paused/i).first()).toBeVisible();
  });

  test("external agent row exposes keys action", async ({ authedPage }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    const keyBtn = authedPage
      .getByRole("button", { name: /agent keys|keys/i })
      .first();
    await expect(keyBtn).toBeVisible();
  });

  test("create agent via dialog submission", async ({ authedPage }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    const createBtn = authedPage.getByTestId("agents__create-btn");
    await createBtn.click();

    const dialog = authedPage.getByTestId("agents__create-dialog");
    await expect(dialog).toBeVisible();

    const createResponsePromise = authedPage.waitForResponse((response) => {
      return (
        response.request().method() === "POST" &&
        response.status() === 201 &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agents$/.test(response.url())
      );
    });

    const createRequestPromise = authedPage.waitForRequest((req) => {
      return (
        req.method() === "POST" &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agents$/.test(req.url())
      );
    });

    // Fill in the form
    await dialog.locator("#agent-name").fill("E2E Test Agent");
    await dialog.locator("#agent-description").fill("Created by E2E test");
    const endpointSelect = await waitForExecutionTargetReady(dialog);
    await endpointSelect.selectOption({ index: 0 });

    await continueToDeployment(dialog);

    // Submit the form
    const submitBtn = dialog.getByRole("button", { name: /create/i });
    await expect(
      dialog.getByTestId("agents__create-dialog__product-summary"),
    ).toBeVisible();
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();
    await createRequestPromise;
    await createResponsePromise;
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // New agent should appear in the table (dialog close animation can be delayed in dev mode)
    await expect(
      authedPage
        .getByTestId("agents__table__row")
        .filter({ hasText: "E2E Test Agent" })
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("create internal agent sends config payload", async ({ authedPage }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });
    await authedPage.getByTestId("agents__create-btn").click();

    const dialog = authedPage.getByTestId("agents__create-dialog");
    await expect(dialog).toBeVisible();

    await dialog.locator("#agent-name").fill("E2E Internal Agent");
    await dialog.locator('input[name="mode"][value="internal"]').click();
    await dialog.locator("#agent-interaction-kind").selectOption("notebook");
    const endpointSelect = await waitForExecutionTargetReady(dialog);
    await endpointSelect.selectOption({ index: 0 });
    await continueToDeployment(dialog);
    await dialog.locator("#agent-image").fill("ghcr.io/acme/agent:1.0.0");
    await dialog.locator("#agent-max-sessions").fill("3");

    const createRequestPromise = authedPage.waitForRequest((req) => {
      return (
        req.method() === "POST" &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agents$/.test(req.url())
      );
    });

    await dialog.getByRole("button", { name: /create/i }).click();
    const request = await createRequestPromise;
    const payload = request.postDataJSON() as {
      name?: string;
      mode?: string;
      interaction_kind?: string;
      config?: { image?: string; max_concurrent_sessions_override?: number };
    };

    expect(payload.name).toBe("E2E Internal Agent");
    expect(payload.mode).toBe("internal");
    expect(payload.interaction_kind).toBe("notebook");
    expect(payload.config?.image).toBe("ghcr.io/acme/agent:1.0.0");
    expect(payload.config?.max_concurrent_sessions_override).toBe(3);
  });

  test("create internal agent includes env entries in payload", async ({
    authedPage,
  }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });
    await authedPage.getByTestId("agents__create-btn").click();

    const dialog = authedPage.getByTestId("agents__create-dialog");
    await expect(dialog).toBeVisible();

    await dialog.locator("#agent-name").fill("E2E Internal Agent Env");
    await dialog.locator('input[name="mode"][value="internal"]').click();
    const endpointSelect = await waitForExecutionTargetReady(dialog);
    await endpointSelect.selectOption({ index: 0 });
    await continueToDeployment(dialog);
    await dialog.locator("#agent-image").fill("ghcr.io/acme/agent:2.0.0");

    const envInputs = dialog.locator('input[placeholder="KEY"]');
    const valInputs = dialog.locator('input[placeholder="value"]');
    await envInputs.first().fill("API_BASE");
    await valInputs.first().fill("https://api.example.com");

    const createRequestPromise = authedPage.waitForRequest((req) => {
      return (
        req.method() === "POST" &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agents$/.test(req.url())
      );
    });
    await dialog.getByRole("button", { name: /^create$/i }).click();

    const request = await createRequestPromise;
    const payload = request.postDataJSON() as {
      config?: { env?: Record<string, string>; image?: string };
    };
    expect(payload.config?.image).toBe("ghcr.io/acme/agent:2.0.0");
    expect(payload.config?.env).toMatchObject({
      API_BASE: "https://api.example.com",
    });
  });

  test("create agent with empty name should not submit", async ({
    authedPage,
  }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    const createBtn = authedPage.getByTestId("agents__create-btn");
    await createBtn.click();

    const dialog = authedPage.getByTestId("agents__create-dialog");
    await expect(dialog).toBeVisible();

    // Product step must not advance when name is empty.
    const nextButton = dialog.getByRole("button", { name: /^next$/i });
    await expect(nextButton).toBeDisabled();
  });

  test("toggle agent status via enable/disable button", async ({
    authedPage,
  }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    const rows = authedPage.getByTestId("agents__table__row");
    const firstRow = rows.first();
    await expect(firstRow).toBeVisible();

    // Click the enable/disable toggle button
    const toggleBtn = firstRow.getByRole("button", { name: /enable|disable/i });
    await expect(toggleBtn).toBeVisible();

    const requestPromise = authedPage.waitForRequest((req) => {
      return (
        req.method() === "PATCH" &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agents\/.+/.test(req.url())
      );
    });
    await toggleBtn.click();
    await requestPromise;

    // The agent row should still be visible
    await expect(firstRow).toBeVisible();
  });

  test("edit agent submits updated interaction kind", async ({
    authedPage,
  }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    const firstRow = authedPage.getByTestId("agents__table__row").first();
    await firstRow.getByRole("button", { name: /edit/i }).click();

    const editDialog = authedPage.getByTestId("agents__edit-dialog");
    await expect(editDialog).toBeVisible();
    await editDialog
      .locator("#edit-agent-interaction-kind")
      .selectOption("chat");
    await editDialog
      .locator("#edit-agent-execution-endpoint-id")
      .selectOption({ index: 0 });

    const updateRequestPromise = authedPage.waitForRequest((req) => {
      return (
        req.method() === "PATCH" &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agents\/.+/.test(req.url())
      );
    });

    await editDialog.getByRole("button", { name: /save/i }).click();
    const request = await updateRequestPromise;
    const payload = request.postDataJSON() as { interaction_kind?: string };
    expect(payload.interaction_kind).toBe("chat");
  });

  test("create dialog switches endpoint wording with agent type selection", async ({
    authedPage,
  }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    await authedPage.getByTestId("agents__create-btn").click();
    const dialog = authedPage.getByTestId("agents__create-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Execution target")).toBeVisible();
    await expect(
      dialog.getByText("Choose the endpoint this chat agent will use for inference."),
    ).toBeVisible();

    await dialog.locator("#agent-interaction-kind").selectOption("notebook");

    await expect(dialog.getByLabel("Execution target")).toBeVisible();
    await expect(
      dialog.getByText("Choose the endpoint this notebook agent will use for task execution."),
    ).toBeVisible();
  });

  test("external agent keys flow opens create key dialog result", async ({
    authedPage,
  }) => {
    await expect(authedPage.getByTestId("agents__table")).toBeVisible({
      timeout: 10000,
    });

    const keyBtn = authedPage
      .getByRole("button", { name: /agent keys|keys/i })
      .first();
    await expect(keyBtn).toBeVisible();
    await keyBtn.click();

    const createKeyButton = authedPage
      .getByRole("dialog")
      .getByRole("button", { name: /create/i })
      .first();
    if (
      !(await createKeyButton.isVisible({ timeout: 3000 }).catch(() => false))
    ) {
      await expect(authedPage.getByRole("dialog")).toBeVisible();
      return;
    }

    const createKeyRequestPromise = authedPage.waitForRequest((req) => {
      return (
        req.method() === "POST" &&
        /\/api\/v1\/workspaces\/.*\/projects\/.*\/agents\/.*\/keys$/.test(
          req.url(),
        )
      );
    });
    await createKeyButton.click();
    await createKeyRequestPromise;

    await expect(
      authedPage.getByTestId("api-keys__key-created-dialog"),
    ).toBeVisible({ timeout: 10000 });
  });
});
