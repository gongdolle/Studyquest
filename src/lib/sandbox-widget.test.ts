import { describe, expect, it } from "vitest";
import {
  buildSandboxWidgetDocument,
  normalizeSandboxWidget,
  type SandboxWidgetSource,
} from "./sandbox-widget";

const validWidget: SandboxWidgetSource = {
  id: "pid-response",
  title: "PID 응답 실험",
  instruction: "슬라이더를 움직여 응답의 변화를 관찰하세요.",
  html: `
    <section class="lab" aria-labelledby="lab-title">
      <h2 id="lab-title">비례 이득</h2>
      <label for="gain">Kp</label>
      <input id="gain" type="range" min="0" max="10" step="1" value="2">
      <output id="result" for="gain">2</output>
    </section>
  `,
  css: ".lab { display: grid; gap: 12px; } input { accent-color: #2563eb; }",
  javascript: `
    const gain = document.querySelector("#gain");
    const result = document.querySelector("#result");
    gain.addEventListener("input", () => { result.textContent = gain.value; });
  `,
  height: 320,
};

describe("normalizeSandboxWidget", () => {
  it("accepts a declarative local widget and clamps its display height", () => {
    const normalized = normalizeSandboxWidget({ ...validWidget, height: 9_999 });

    expect(normalized).toMatchObject({
      id: "pid-response",
      title: "PID 응답 실험",
      height: 720,
    });
    expect(normalized?.html).toContain('type="range"');
  });

  it.each(["script", "iframe", "object", "embed", "meta", "link", "base", "form"])(
    "rejects a forbidden <%s> element",
    (tagName) => {
      expect(normalizeSandboxWidget({
        ...validWidget,
        html: `<div>safe</div><${tagName}>unsafe</${tagName}>`,
      })).toBeNull();
    },
  );

  it("rejects inline handlers, external URLs, unknown attributes and malformed tags", () => {
    const unsafeHtml = [
      '<button onclick="alert(1)">run</button>',
      '<img src="https://example.com/a.png" alt="external">',
      '<a href="https://example.com">external</a>',
      '<img srcset="https://example.com/a.png 1x" alt="external">',
      '<div style="background:red">style</div>',
      '<div title=">">ambiguous</div>',
    ];

    for (const html of unsafeHtml) {
      expect(normalizeSandboxWidget({ ...validWidget, html }), html).toBeNull();
    }
  });

  it("allows only base64 raster data images and same-document fragment links", () => {
    const normalized = normalizeSandboxWidget({
      ...validWidget,
      html: '<img src="data:image/png;base64,iVBORw0KGgo=" alt="plot"><a href="#details">설명</a><p id="details">본문</p>',
    });

    expect(normalized).not.toBeNull();
    expect(normalizeSandboxWidget({
      ...validWidget,
      html: '<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="svg">',
    })).toBeNull();
  });

  it.each([
    '@import "https://example.com/theme.css";',
    "div { background: url(https://example.com/a.png); }",
    "div { width: expression(alert(1)); }",
    "div { behavior: url(x.htc); }",
    "div { background: image-set('https://example.com/a.png' 1x); }",
    "div { color: \\72 ed; }",
  ])("rejects unsafe CSS: %s", (css) => {
    expect(normalizeSandboxWidget({ ...validWidget, css })).toBeNull();
  });

  it.each([
    "fetch('/answer')",
    "new XMLHttpRequest()",
    "new WebSocket('wss://example.com')",
    "new Worker('worker.js')",
    "localStorage.setItem('answer', '1')",
    "document.cookie = 'answer=1'",
    "parent.postMessage({}, '*')",
    "top.location = 'https://example.com'",
    "opener.close()",
    "location.assign('https://example.com')",
    "eval('1 + 1')",
    "new Function('return 1')()",
    "import('./module.js')",
    "WebAssembly.instantiate(new Uint8Array())",
    "postMessage({ answer: 1 })",
    "setInterval(() => {}, 100)",
    "setTimeout(() => {}, 100)",
    "requestAnimationFrame(() => {})",
    "while (true) {}",
    "do {} while (true)",
    "for (;;) {}",
  ])("rejects a forbidden JavaScript capability: %s", (javascript) => {
    expect(normalizeSandboxWidget({ ...validWidget, javascript })).toBeNull();
  });
});

describe("buildSandboxWidgetDocument", () => {
  it("emits a nonce-only CSP, widget source and trusted interaction bridge", () => {
    const document = buildSandboxWidgetDocument(validWidget);
    const nonce = document.match(/style nonce="([a-f0-9]+)"/)?.[1];

    expect(nonce).toHaveLength(48);
    expect(document).toContain("default-src 'none'");
    expect(document).toContain(`script-src 'nonce-${nonce}'`);
    expect(document).toContain(`style-src 'nonce-${nonce}'`);
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("img-src data:");
    expect(document).toContain("media-src 'none'");
    expect(document).toContain("font-src 'none'");
    expect(document).toContain("frame-src 'none'");
    expect(document).toContain("object-src 'none'");
    expect(document).toContain("worker-src 'none'");
    expect(document.match(new RegExp(`script nonce="${nonce}"`, "g"))).toHaveLength(2);
    expect(document).toContain('type: "studyquest-widget-interacted", widgetId');
    expect(document).toContain('const widgetId = "pid-response";');
    expect(document).toContain('if (!event.isTrusted) return;');
    expect(document).toContain(validWidget.javascript.trim());
  });

  it("escapes the document title and refuses bypass through a typed value", () => {
    const safe = buildSandboxWidgetDocument({ ...validWidget, title: "gain < response" });
    expect(safe).toContain("<title>gain &lt; response</title>");

    expect(() => buildSandboxWidgetDocument({
      ...validWidget,
      javascript: "fetch('https://example.com')",
    })).toThrow("Unsafe sandbox widget source");
  });
});
