import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] ?? 9223);
const outputRoot = path.resolve(process.argv[3] ?? ".tmp/qa-captures");
await mkdir(outputRoot, { recursive: true });

let pages;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    if (pages.some((page) => page.type === "page")) break;
  } catch {
    // The packaged window may still be starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const page = pages?.find((candidate) => candidate.type === "page");
if (!page?.webSocketDebuggerUrl) throw new Error("StudyQuest CDP page was not found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function call(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  return call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
}

async function capture(name) {
  const result = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path.join(outputRoot, name), Buffer.from(result.data, "base64"));
}

await call("Page.enable");
await capture("01-onboarding.png");
await evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('AI와 설정'))?.click()`);
await new Promise((resolve) => setTimeout(resolve, 400));
await capture("02-settings-top.png");
await evaluate(`document.querySelector('.page-scroll').scrollTop = 520`);
await new Promise((resolve) => setTimeout(resolve, 200));
await capture("03-settings-api.png");
socket.close();
console.log(outputRoot);
