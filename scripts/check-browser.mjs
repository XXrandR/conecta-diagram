import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import { delimiter, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const path = resolve(
      root,
      `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`,
    );
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const body = await readFile(path);
    response.setHeader(
      "Content-Type",
      path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const name = process.env.BROWSER_BINARY ?? "chromium";
  let executablePath = name;
  if (!isAbsolute(name)) {
    executablePath = "";
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      const candidate = resolve(directory, name);
      try {
        await access(candidate);
        executablePath = candidate;
        break;
      } catch {}
    }
  }
  if (!executablePath)
    throw new Error("Install Chromium or set BROWSER_BINARY.");
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: false,
  });
  const errors = [];
  const observe = (target) => {
    target.on("pageerror", (error) => errors.push(error.message));
    target.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1")
        errors.push(`Unexpected request ${url.origin}`);
    });
  };
  observe(page);
  const state = () =>
    page.evaluate(async () =>
      (await import("/examples/demo.js")).app.source.getSnapshot(),
    );
  const installTestHandle = () =>
    page.evaluate(async () => {
      window.__workflowTestApp = (await import("/examples/demo.js")).app;
    });
  const command = (name, payload = {}) =>
    page.evaluate(
      async ([name, payload]) =>
        (await import("/examples/demo.js")).app.source.command(name, payload),
      [name, payload],
    );
  const menu = async (target, action) => {
    await target.getByLabel("More DevTools options", { exact: true }).click();
    await target.getByRole("button", { name: action, exact: true }).click();
  };
  const drag = async (target, dx, dy) => {
    const box = await target.boundingBox();
    check(box, "Missing resize handle");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + dx,
      box.y + box.height / 2 + dy,
      { steps: 6 },
    );
    await page.mouse.up();
  };

  await page.goto(`${base}/tests/browser.html`);
  await page
    .locator('#result[data-status="passed"],#result[data-status="failed"]')
    .waitFor({ timeout: 15000 });
  check(
    (await page.locator("#result").getAttribute("data-status")) === "passed",
    await page.locator("#result").textContent(),
  );
  await page.goto(`${base}/examples/index.html`);
  await page.getByRole("tab", { name: "Assemble", exact: true }).waitFor();
  await installTestHandle();
  check(
    (await page
      .locator(".inspector-panel,.execution-console,#details,.metadata-editor")
      .count()) === 0,
    "Old panel shells survived.",
  );
  check(
    JSON.stringify(await page.getByRole("tab").allTextContents()) ===
      JSON.stringify(["Assemble", "Trace", "Performance inspection"]),
    "Wrong DevTools tab structure.",
  );
  check(
    (await page.locator(".construction-pane").textContent()).trim() ===
      "In construction",
    "Assemble right pane has extra content.",
  );
  check(
    (await page.locator(".variable-chip").count()) === 4,
    "Globals are missing from the diagram.",
  );
  check(
    JSON.stringify(
      await page
        .locator(".variable-chip")
        .evaluateAll((chips) => chips.map((chip) => chip.dataset.variableType)),
    ) === JSON.stringify(["array", "boolean", "integer", "json"]),
    "Missing variable type badges.",
  );
  const order = await page
    .locator(".assemble-item")
    .evaluateAll((rows) => rows.map((row) => row.dataset.itemType));
  check(
    order.slice(0, 4).every((type) => type === "global") && order[4] === "node",
    "Globals are not pinned above creation-order items.",
  );
  const structure = await page
    .locator('[data-node-id="python"] .flow-node')
    .evaluate((node) => ({
      classes: [...node.children].map((child) => child.className),
      stripe: getComputedStyle(node, "::before").width,
      title: getComputedStyle(node.querySelector(".node-title")).fontSize,
      icon: getComputedStyle(node.querySelector(".node-icon")).width,
    }));
  check(
    JSON.stringify(structure.classes) ===
      JSON.stringify([
        "node-header",
        "signals",
        "action-preview",
        "node-divider",
        "node-footer",
      ]),
    "Photon card structure differs from the template.",
  );
  check(
    structure.stripe === "3px" &&
      structure.title === "13.5px" &&
      structure.icon === "32px",
    "Photon geometry is incorrect.",
  );

  await page.locator('[data-node-id="python"]').dispatchEvent("click");
  await page
    .locator('[name="node-label"]')
    .fill("Normalize order · customized");
  await page.getByRole("button", { name: "Save node", exact: true }).click();
  await page.waitForFunction(() =>
    window.__workflowTestApp.store
      .getSnapshot()
      .nodes.find((node) => node.id === "python")
      .label.includes("customized"),
  );
  await page.reload();
  await page.getByRole("tab", { name: "Assemble", exact: true }).waitFor();
  await installTestHandle();
  check(
    (await state()).document.nodes.find((node) => node.id === "python")
      .label === "Normalize order · customized",
    "Node edits did not persist.",
  );
  await page.locator('[data-global-id="global-enabled"]').click();
  await page.locator('[name="global-value"]').fill("false");
  await page
    .getByRole("button", { name: "Save variable", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.__workflowTestApp.store
        .getSnapshot()
        .globals.find((variable) => variable.id === "global-enabled").value ===
      false,
  );
  await command("select", { selection: null });
  await page
    .getByRole("button", { name: "Add global variable", exact: true })
    .click();
  await page.locator('[name="global-name"]').fill("sessionConfig");
  await page.locator('[name="global-value"]').fill('{"nested":[true,2,null]}');
  await page
    .getByRole("button", { name: "Save variable", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".variable-chip").length === 5,
  );
  await command("select", { selection: null });
  const canvas = await page.locator("#canvas").boundingBox();
  await page
    .locator("#canvas")
    .click({ position: { x: canvas.width - 4, y: canvas.height - 4 } });
  check(
    (await page.locator('.assemble-item[data-item-type="global"]').count()) ===
      5,
    "Background selection did not show all items.",
  );
  await drag(
    page.getByRole("separator", {
      name: "Resize assemble-left subsections",
      exact: true,
    }),
    55,
    0,
  );
  await drag(
    page.getByRole("separator", {
      name: "Resize DevTools docked bottom",
      exact: true,
    }),
    0,
    -35,
  );
  const sizes = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wf-panel-sizes")),
  );
  check(
    sizes["assemble-left"] > 0.6 && sizes["dock-bottom"] > 360,
    "Resize values did not persist under wf-panel-sizes.",
  );
  await page.reload();
  await page.getByRole("tab", { name: "Assemble", exact: true }).waitFor();
  await installTestHandle();
  check(
    Math.abs(
      (await page.locator("#devtools-root").boundingBox()).height -
        sizes["dock-bottom"],
    ) < 3,
    "Dock size did not survive reload.",
  );

  await page.getByRole("tab", { name: "Trace", exact: true }).click();
  await page.locator("#speed").selectOption("120");
  for (const scenario of ["approve", "decline", "failure", "timeout"]) {
    await page.locator("#scenario").selectOption(scenario);
    await page
      .getByRole("button", { name: "Play simulated events", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document
          .getElementById("status")
          .textContent.startsWith("Replay completed"),
      null,
      { timeout: 15000 },
    );
    const id =
      scenario === "approve" ? "yes" : scenario === "decline" ? "no" : "file";
    check(
      (await page
        .locator(`[data-node-id="${id}"]`)
        .getAttribute("data-state")) ===
        (scenario === "failure"
          ? "failed"
          : scenario === "timeout"
            ? "timed_out"
            : "completed"),
      `Replay ${scenario} changed behavior.`,
    );
    if (scenario === "approve") {
      const total = Number(
        await page.locator("#metric-observations").textContent(),
      );
      check(
        total === 35 && (await page.locator("#event-rows tr").count()) === 30,
        "Trace model/pagination changed.",
      );
      await page
        .getByRole("button", { name: "Next observation page", exact: true })
        .click();
      check(
        (await page.locator("#event-rows tr").count()) === 5,
        "Older trace actions lost.",
      );
      await page.locator("#event-node").selectOption("file");
      await page.locator("#event-outcome").selectOption("streaming");
      check(
        (await page.locator("#event-rows tr").count()) === 2,
        "Trace filters changed.",
      );
      await page.locator("#event-rows .event-title").first().click();
      const detail = await page.locator("#event-detail").textContent();
      check(
        detail.includes("32768") && detail.includes("65536"),
        "Exact transfer inspection lost.",
      );
      await page.evaluate(() => {
        window.originalURL = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
          window.exportBlob = blob;
          return window.originalURL(blob);
        };
      });
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name: "Export complete observation trace",
          exact: true,
        })
        .click();
      await download;
      const count = await page.evaluate(async () => {
        URL.createObjectURL = window.originalURL;
        const data = JSON.parse(await window.exportBlob.text());
        delete window.originalURL;
        delete window.exportBlob;
        return data.entries.length;
      });
      check(count === total, "Trace export is no longer complete.");
      await page.locator("#event-node").selectOption("all");
      await page.locator("#event-outcome").selectOption("all");
      await page.locator("#event-follow").check();
    }
  }
  await page
    .getByRole("tab", { name: "Performance inspection", exact: true })
    .click();
  check(
    JSON.stringify(
      await page
        .locator(".performance-track")
        .evaluateAll((rows) => rows.map((row) => row.dataset.track)),
    ) === JSON.stringify(["parent", "network", "memory", "cost"]),
    "Performance has wrong tracks or a lower trace strip.",
  );
  await page.evaluate(async () =>
    (await import("/examples/demo.js")).app.recordPerformance({
      runId: "backend-17",
      nodeId: "python",
      commandId: "backend-command",
      process: "Parent process",
      startMs: 2000,
      durationMs: 100,
      cost: 17,
    }),
  );
  check(
    (await page.locator('[data-track="cost"]').textContent()).includes(
      "backend cost 17",
    ),
    "Cost is not reading the backend integer.",
  );
  const rejected = await page.evaluate(async () => {
    try {
      (await import("/examples/demo.js")).app.recordPerformance({
        runId: "bad",
        nodeId: "python",
        commandId: "bad",
        process: "Parent",
        startMs: 0,
        durationMs: 1,
        cost: 1.5,
      });
      return false;
    } catch {
      return true;
    }
  });
  check(rejected, "Fractional backend cost accepted.");
  await page
    .getByRole("separator", { name: "Resize Cost track", exact: true })
    .press("ArrowDown");
  await page
    .getByRole("separator", {
      name: "Resize performance top graph",
      exact: true,
    })
    .press("ArrowUp");
  check(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("wf-panel-sizes"))["track-cost"] > 64,
    ),
    "Track resize not persisted.",
  );
  for (const dock of ["right", "left", "bottom"]) {
    await menu(page, `Dock to ${dock}`);
    check(
      (await page.locator("#workspace-layout").getAttribute("data-dock")) ===
        dock,
      `Dock ${dock} failed.`,
    );
  }

  await page.getByRole("tab", { name: "Assemble", exact: true }).click();
  const popupEvent = page.waitForEvent("popup");
  await menu(page, "Separate window");
  const popup = await popupEvent;
  observe(popup);
  await popup.getByRole("tab", { name: "Assemble", exact: true }).waitFor();
  check(
    (await page.locator("#devtools-root").isHidden()) &&
      (await page.locator("#devtools-root").locator("*").count()) === 0,
    "Detached UI duplicated the opener shell.",
  );
  await page.locator('[data-node-id="python"]').dispatchEvent("click");
  await popup.locator('[name="node-label"]').waitFor();
  await popup.locator('[name="node-label"]').fill("Edited in detached window");
  await popup.getByRole("button", { name: "Save node", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__workflowTestApp.store
        .getSnapshot()
        .nodes.find((node) => node.id === "python").label ===
      "Edited in detached window",
  );
  await page.locator("#theme-toggle").click();
  await popup.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector('[data-node-id="python"] .flow-node'),
      ).backgroundColor === "rgb(28, 28, 31)",
  );
  check(
    (await page
      .locator('[data-node-id="python"] .flow-node')
      .evaluate((node) => getComputedStyle(node).backgroundColor)) ===
      "rgb(28, 28, 31)",
    "Dark node palette differs from Photon.",
  );
  check(
    (await popup.locator("html").getAttribute("data-theme")) === "dark",
    "Detached theme did not sync.",
  );
  await popup.getByRole("tab", { name: "Trace", exact: true }).click();
  await popup.locator("#scenario").selectOption("approve");
  await popup.locator("#speed").selectOption("120");
  await page.waitForFunction(() => {
    const state = window.__workflowTestApp.source.getSnapshot();
    return (
      state.playback.scenario === "approve" &&
      state.playback.speed === 120 &&
      state.playback.state === "Ready"
    );
  });
  await popup
    .getByRole("button", { name: "Play simulated events", exact: true })
    .click();
  await page.waitForFunction(
    () => {
      const state = window.__workflowTestApp.source.getSnapshot();
      return (
        state.playback.state === "Complete" &&
        state.journal.entries.length === 35
      );
    },
    null,
    { timeout: 15000 },
  );
  const detachedState = await state();
  check(
    detachedState.journal.entries.length === 35,
    `Detached replay state changed unexpectedly: ${JSON.stringify({ playback: detachedState.playback, entries: detachedState.journal.entries.length, runId: detachedState.journal.runId })}`,
  );
  await popup.locator("#scenario").selectOption("decline");
  await popup.locator("#speed").selectOption("600");
  await page.waitForFunction(() => {
    const state = window.__workflowTestApp.source.getSnapshot();
    return (
      state.playback.scenario === "decline" &&
      state.playback.speed === 600 &&
      state.playback.state === "Ready"
    );
  });
  await popup
    .getByRole("button", { name: "Play simulated events", exact: true })
    .click();
  await popup.getByRole("button", { name: "Stop replay", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__workflowTestApp.source.getSnapshot().playback.state === "Paused",
  );
  const stopped = (await state()).playback.cursor;
  await page.waitForTimeout(750);
  check(
    (await state()).playback.cursor === stopped,
    "Stop did not call the original timer cancellation.",
  );
  await popup.close();
  await page.locator("#devtools-root").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Reset events", exact: true }).click();
  check(
    (await state()).journal.entries.length === 0,
    "Reset did not clear the existing trace model.",
  );
  await page
    .getByRole("button", { name: "Close DevTools", exact: true })
    .click();
  check(
    await page.locator("#devtools-root").isHidden(),
    "Close DevTools failed.",
  );
  await page.locator("#open-devtools").click();
  await page.evaluate(async () =>
    (await import("/examples/demo.js")).app.devtools.registerTab({
      id: "diagnostics",
      label: "Diagnostics",
      mount({ container }) {
        container.textContent = "Registered without shell edits";
        return {};
      },
    }),
  );
  await page.getByRole("tab", { name: "Diagnostics", exact: true }).click();
  check(
    (await page
      .getByRole("tabpanel", { name: "Diagnostics" })
      .textContent()) === "Registered without shell edits",
    "Tab registration API failed.",
  );
  await page.getByRole("tab", { name: "Assemble", exact: true }).click();
  await command("select", { selection: null });
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.SCREENSHOT_PATH,
      fullPage: true,
    });
  await page.reload();
  await page.getByRole("tab", { name: "Assemble", exact: true }).waitFor();
  check(
    (await page.locator("html").getAttribute("data-theme")) === "dark",
    "Theme did not survive reload.",
  );
  await page.locator("#theme-toggle").click();
  check(
    (await page.locator("html").getAttribute("data-theme")) === "light",
    "Light theme toggle failed.",
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Chromium passed: Photon cards/themes, globals/order/edit persistence, original replay+Trace migration, resizers/docks, real detached-window sync, backend-cost graphs, tab registration and old-shell removal.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
