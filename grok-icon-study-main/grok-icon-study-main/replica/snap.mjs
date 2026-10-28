#!/usr/bin/env node
// Headless snapshot of replica/index.html against $_t mn() invariants.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGE = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "index.html")).href;
const OUT = process.env.SNAP_DIR || "/tmp/grok-replica-snap";

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text || "evaluate failed");
    }
    return r.result.value;
  }
}

function waitPort(child) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const on = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) resolve(m[1]);
    };
    child.stderr.on("data", on);
    child.stdout.on("data", on);
    child.on("exit", (code) => reject(new Error(`chrome exited ${code}: ${buf.slice(-400)}`)));
    setTimeout(() => reject(new Error(`chrome debug timeout: ${buf.slice(-400)}`)), 15000);
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function shot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
}

const SNAP_JS = `(() => {
  const bot = window.__bots && window.__bots[0];
  const svg = document.getElementById("bot");
  const body = bot?.body || svg?.querySelector("g > path");
  const eyes = bot?.eyeEls || svg?.querySelectorAll("g g path");
  const d = body?.getAttribute("d") || "";
  const eye = (el) => el ? ({
    d: (el.getAttribute("d") || "").slice(0, 48),
    t: el.getAttribute("transform") || "",
    display: el.style.display || "",
  }) : null;
  return {
    state: bot?.state,
    mode: bot?.mode,
    shape: bot?.shapeName,
    eyeFrom: bot?.eyeFrom,
    eyeTo: bot?.eyeTo,
    morph: bot?.eyeMorph?.x,
    blink: bot?.blink?.x,
    overlayX: bot?.overlay?.x,
    ovKind: bot?.ovKind,
    spin: bot?.spin?.x,
    bodyN: d.length,
    bodyHead: d.slice(0, 72),
    eyes: [eye(eyes?.[0]), eye(eyes?.[1])],
  };
})()`;

async function snap(cdp, label) {
  const data = await cdp.eval(SNAP_JS);
  data.label = label;
  return data;
}

async function click(cdp, sel) {
  await cdp.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const profile = await mkdtemp(join(tmpdir(), "grok-snap-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--hide-scrollbars",
    "--window-size=1100,900",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--allow-file-access-from-files",
    PAGE,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const browserWs = await waitPort(chrome);
  const port = new URL(browserWs).port;
  let pageWs = null;
  for (let i = 0; i < 40; i++) {
    const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    const page = tabs.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (page) {
      pageWs = page.webSocketDebuggerUrl;
      break;
    }
    await sleep(100);
  }
  if (!pageWs) throw new Error("no page target");
  const ws = new WebSocket(pageWs);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.bringToFront");
  for (let i = 0; i < 50; i++) {
    const ready = await cdp.eval("!!(window.__bots && window.__bots[0] && window.__bots[0].body)");
    if (ready) break;
    await sleep(100);
  }
  await click(cdp, "#mode-hold");
  await click(cdp, "#opt-follow"); // default on → off for stable transforms
  await sleep(80);

  const report = [];
  const states = [
    "playful", "laughing", "sleeping", "idle", "celebrate",
    "thinking", "writing", "orbit", "humming", "loading",
  ];
  for (const name of states) {
    await click(cdp, `button[data-state="${name}"]`);
    await sleep(name === "sleeping" ? 400 : 700);
    const s = await snap(cdp, name);
    report.push(s);
    await shot(cdp, name);
  }

  // sleeping timeline: start from curious (eye 3) then sleep
  await click(cdp, 'button[data-state="curious"]');
  await sleep(200);
  await click(cdp, 'button[data-state="sleeping"]');
  for (const ms of [300, 1300, 2200]) {
    await sleep(ms === 300 ? 300 : ms - (ms === 1300 ? 300 : 1300));
    report.push(await snap(cdp, `sleeping@${ms}ms`));
  }
  await shot(cdp, "sleeping-late");

  // turnAt: bean / tablet / cloud + one spin, sample eyes
  for (const shape of ["bean", "tablet", "cloud"]) {
    await click(cdp, 'button[data-state="idle"]');
    await click(cdp, `button[data-shape="${shape}"]`);
    await sleep(80);
    await click(cdp, "#act-spin");
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await sleep(90);
      samples.push(await snap(cdp, `${shape}-spin-${i}`));
    }
    report.push({
      label: `${shape}-spin`,
      shape,
      hidden: samples.filter((s) => s.eyes?.some((e) => e.display === "none")).length,
      shown: samples.filter((s) => s.eyes?.every((e) => e.display !== "none")).length,
      transforms: [...new Set(samples.map((s) => s.eyes?.[0]?.t).filter(Boolean))].length,
      ovKind: samples[0]?.ovKind,
      samples: samples.map((s) => ({
        t: s.eyes?.[0]?.t?.slice(0, 40),
        d0: s.eyes?.[1]?.display,
        d1: s.eyes?.[0]?.display,
        bodyHead: s.bodyHead,
      })),
    });
    await shot(cdp, `${shape}-spin`);
  }

  await writeFile(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  chrome.kill("SIGTERM");
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
