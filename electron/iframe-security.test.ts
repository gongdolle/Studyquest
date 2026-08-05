import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("AI iframe widget security boundary", () => {
  it("keeps the parent renderer CSP strict while allowing only its fixed frame host", () => {
    const index = read("index.html");
    const csp = index.match(/content="([^"]*default-src[^"]*)"/)?.[1] ?? "";

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' blob:");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src studyquest-widget:");
  });

  it("uses allow-scripts as the iframe's only sandbox capability", () => {
    const component = read("src/components/SandboxLessonWidget.tsx");

    expect(component).toContain('sandbox="allow-scripts"');
    for (const forbidden of [
      "allow-same-origin",
      "allow-popups",
      "allow-top-navigation",
      "allow-downloads",
      "allow-forms",
      "allow-modals",
      "allow-pointer-lock",
    ]) expect(component).not.toContain(forbidden);
    expect(component).toContain('event.source !== frameRef.current?.contentWindow');
    expect(component).toContain('event.origin !== "null"');
    expect(component).toContain('protocol: "studyquest-widget/v1"');
  });

  it("keeps iframe Node and IPC surfaces disabled and blocks frame navigation", () => {
    const main = read("electron/main.cjs");

    expect(main).toContain("nodeIntegrationInSubFrames: false");
    expect(main).toContain("webviewTag: false");
    expect(main).toContain("protocol.registerSchemesAsPrivileged");
    expect(main).toContain("protocol.handle(WIDGET_SCHEME");
    expect(main).toContain("const WIDGET_HOST_URL = `${WIDGET_SCHEME}://runtime/index.html`");
    expect(main).toContain("types: ['mainFrame', 'subFrame']");
    expect(main).toContain("details.resourceType === 'mainFrame'");
    expect(main).toContain("isTrustedWidgetHostUrl(details.url)");
    expect(main).toContain("on('will-frame-navigate'");
    expect(main).toContain("isTrustedWidgetHostUrl(details.url)");
    expect(main).toContain("event.senderFrame?.parent");
  });

  it("executes generated code only in the fixed host with network and nested frames disabled", () => {
    const host = read("public/widget-host.html");
    const runtime = read("public/widget-host.js");

    expect(host).toContain("connect-src 'none'");
    expect(host).toContain("frame-src 'none'");
    expect(host).toContain("worker-src 'none'");
    expect(host).toContain("object-src 'none'");
    expect(runtime).toContain("URL.createObjectURL(new Blob");
    expect(runtime).toContain("if (!event.isTrusted) return");
    expect(runtime).not.toContain("eval(");
    expect(runtime).not.toContain("new Function");
  });
});
