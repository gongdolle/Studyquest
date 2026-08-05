export interface SandboxWidgetSource {
  id: string;
  title: string;
  instruction: string;
  html: string;
  css: string;
  javascript: string;
  height: number;
}

const MAX_HTML_LENGTH = 20_000;
const MAX_CSS_LENGTH = 20_000;
const MAX_JAVASCRIPT_LENGTH = 30_000;
const MIN_WIDGET_HEIGHT = 260;
const MAX_WIDGET_HEIGHT = 720;

const INVALID_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const ALLOWED_HTML_TAGS = new Set([
  "a",
  "article",
  "aside",
  "blockquote",
  "br",
  "button",
  "canvas",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "img",
  "input",
  "kbd",
  "label",
  "li",
  "main",
  "mark",
  "meter",
  "nav",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "pre",
  "progress",
  "q",
  "samp",
  "section",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
]);

const GLOBAL_HTML_ATTRIBUTES = new Set([
  "class",
  "dir",
  "hidden",
  "id",
  "lang",
  "role",
  "tabindex",
  "title",
]);

const TAG_HTML_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  a: new Set(["href"]),
  button: new Set(["disabled", "name", "type", "value"]),
  canvas: new Set(["height", "width"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  details: new Set(["open"]),
  img: new Set(["alt", "height", "src", "width"]),
  input: new Set([
    "checked",
    "disabled",
    "max",
    "maxlength",
    "min",
    "minlength",
    "multiple",
    "name",
    "placeholder",
    "readonly",
    "required",
    "step",
    "type",
    "value",
  ]),
  label: new Set(["for"]),
  li: new Set(["value"]),
  meter: new Set(["high", "low", "max", "min", "optimum", "value"]),
  ol: new Set(["reversed", "start", "type"]),
  optgroup: new Set(["disabled", "label"]),
  option: new Set(["disabled", "label", "selected", "value"]),
  output: new Set(["for", "name"]),
  progress: new Set(["max", "value"]),
  select: new Set(["disabled", "multiple", "name", "required", "size"]),
  td: new Set(["colspan", "headers", "rowspan"]),
  textarea: new Set([
    "cols",
    "disabled",
    "maxlength",
    "minlength",
    "name",
    "placeholder",
    "readonly",
    "required",
    "rows",
    "wrap",
  ]),
  th: new Set(["abbr", "colspan", "headers", "rowspan", "scope"]),
  time: new Set(["datetime"]),
};

const BOOLEAN_HTML_ATTRIBUTES = new Set([
  "checked",
  "disabled",
  "hidden",
  "multiple",
  "open",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

const FORBIDDEN_HTML_TAG =
  /<\s*\/?\s*(?:applet|base|embed|form|frame|frameset|iframe|link|math|meta|object|portal|script|style|svg|template)\b/i;
const HTML_TAG = /<\/?[A-Za-z][^<>]*>/g;
const HTML_ATTRIBUTE =
  /^\s+([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/;
const DATA_IMAGE = /^data:image\/(?:gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
const LOCAL_FRAGMENT = /^#[A-Za-z][A-Za-z0-9_:.-]*$/;

const FORBIDDEN_CSS = [
  /@\s*import\b/i,
  /@\s*(?:document|font-face|namespace)\b/i,
  /\burl\s*\(/i,
  /\bexpression\s*\(/i,
  /\blocal\s*\(/i,
  /(?:javascript|vbscript)\s*:/i,
  /(?:https?|ftp|file|data|blob)\s*:/i,
  /(?:^|[^:])\/\//,
  /(?:behavior|-moz-binding)\s*:/i,
  /<\s*\/?\s*style\b/i,
  /\/\*/,
  /\\/,
];

const FORBIDDEN_JAVASCRIPT = [
  /\bfetch\b/i,
  /\bXMLHttpRequest\b/,
  /\b(?:WebSocket|WebTransport|EventSource|RTCPeerConnection)\b/,
  /\b(?:Worker|SharedWorker|ServiceWorker|importScripts)\b/,
  /\b(?:localStorage|sessionStorage|indexedDB|storage|caches|cookie)\b/i,
  /\b(?:parent|top|opener|location)\b/i,
  /\beval\b/,
  /\bFunction\b/,
  /\bimport\b/,
  /\bWebAssembly\b/,
  /\bpostMessage\b/i,
  /\b(?:window|globalThis|self|frames|navigator|history)\b/,
  /\b(?:sendBeacon|BroadcastChannel|Notification)\b/,
  /\b(?:constructor|__proto__|prototype|defaultView)\b/,
  /\b(?:Reflect|Proxy)\b/,
  /\b(?:createElement|createElementNS|write|writeln)\s*\(/,
  /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/,
  /\bdocument\s*\[/,
  /\b(?:atob|fromCharCode|fromCodePoint)\s*\(/,
  /\bset(?:Timeout|Interval)\s*\(/,
  /\b(?:requestAnimationFrame|queueMicrotask)\s*\(/,
  /\bwhile\s*\(/,
  /\bdo\s*\{/,
  /\bfor\s*\(\s*;\s*;/,
  /\\(?:x[0-9a-f]{2}|u\{?[0-9a-f])/i,
  /<\s*\/?\s*script\b/i,
  /<!--|-->/,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizePlainText = (value: unknown, maximumLength: number): string | null => {
  if (typeof value !== "string" || INVALID_CONTROL_CHARACTERS.test(value)) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) return null;
  return normalized;
};

const isAllowedAttribute = (tagName: string, attributeName: string): boolean =>
  GLOBAL_HTML_ATTRIBUTES.has(attributeName)
  || TAG_HTML_ATTRIBUTES[tagName]?.has(attributeName) === true
  || /^aria-[a-z0-9-]+$/.test(attributeName)
  || /^data-[a-z0-9-]+$/.test(attributeName);

const isSafeAttributeValue = (
  tagName: string,
  attributeName: string,
  value: string | undefined,
): boolean => {
  if (value === undefined) return BOOLEAN_HTML_ATTRIBUTES.has(attributeName);
  if (value.includes("&") || INVALID_CONTROL_CHARACTERS.test(value)) return false;
  if (attributeName === "src") return tagName === "img" && DATA_IMAGE.test(value);
  if (attributeName === "href") return tagName === "a" && LOCAL_FRAGMENT.test(value);
  return true;
};

const isSafeHtmlTag = (token: string): boolean => {
  const closing = /^<\s*\/\s*([A-Za-z][A-Za-z0-9-]*)\s*>$/.exec(token);
  if (closing) return ALLOWED_HTML_TAGS.has(closing[1].toLowerCase());

  const opening = /^<\s*([A-Za-z][A-Za-z0-9-]*)([\s\S]*?)\s*\/?>$/.exec(token);
  if (!opening) return false;
  const tagName = opening[1].toLowerCase();
  if (!ALLOWED_HTML_TAGS.has(tagName)) return false;

  let attributes = opening[2];
  if (/\/\s*$/.test(attributes)) attributes = attributes.replace(/\/\s*$/, "");
  const seenAttributes = new Set<string>();
  while (attributes.length > 0) {
    if (/^\s*$/.test(attributes)) break;
    const match = HTML_ATTRIBUTE.exec(attributes);
    if (!match) return false;
    const attributeName = match[1].toLowerCase();
    const attributeValue = match[2] ?? match[3] ?? match[4];
    if (
      attributeName.startsWith("on")
      || attributeName === "style"
      || attributeName === "srcdoc"
      || seenAttributes.has(attributeName)
      || !isAllowedAttribute(tagName, attributeName)
      || !isSafeAttributeValue(tagName, attributeName, attributeValue)
    ) {
      return false;
    }
    seenAttributes.add(attributeName);
    attributes = attributes.slice(match[0].length);
  }
  return true;
};

const isSafeHtml = (value: string): boolean => {
  if (
    !value.trim()
    || value.length > MAX_HTML_LENGTH
    || INVALID_CONTROL_CHARACTERS.test(value)
    || FORBIDDEN_HTML_TAG.test(value)
  ) {
    return false;
  }

  const textWithoutTags = value.replace(HTML_TAG, "");
  if (/[<>]/.test(textWithoutTags)) return false;

  HTML_TAG.lastIndex = 0;
  let token: RegExpExecArray | null;
  while ((token = HTML_TAG.exec(value)) !== null) {
    if (!isSafeHtmlTag(token[0])) return false;
  }
  return true;
};

const isSafeCss = (value: string): boolean =>
  value.length <= MAX_CSS_LENGTH
  && !INVALID_CONTROL_CHARACTERS.test(value)
  && FORBIDDEN_CSS.every((pattern) => !pattern.test(value));

const isSafeJavascript = (value: string): boolean =>
  value.length <= MAX_JAVASCRIPT_LENGTH
  && !INVALID_CONTROL_CHARACTERS.test(value)
  && FORBIDDEN_JAVASCRIPT.every((pattern) => !pattern.test(value));

/**
 * Performs conservative, string-only validation for AI-authored iframe widgets.
 * The returned source is safe to hand to buildSandboxWidgetDocument; invalid
 * markup or capabilities reject the entire widget rather than being rewritten.
 */
export function normalizeSandboxWidget(value: unknown): SandboxWidgetSource | null {
  if (!isRecord(value)) return null;

  const id = normalizePlainText(value.id, 100);
  const title = normalizePlainText(value.title, 200);
  const instruction = normalizePlainText(value.instruction, 1_000);
  if (
    !id
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id)
    || !title
    || !instruction
    || typeof value.html !== "string"
    || typeof value.css !== "string"
    || typeof value.javascript !== "string"
    || !isSafeHtml(value.html)
    || !isSafeCss(value.css)
    || !isSafeJavascript(value.javascript)
  ) {
    return null;
  }

  const height = Number(value.height);
  if (!Number.isFinite(height)) return null;

  return {
    id,
    title,
    instruction,
    html: value.html.trim(),
    css: value.css.trim(),
    javascript: value.javascript.trim(),
    height: Math.min(MAX_WIDGET_HEIGHT, Math.max(MIN_WIDGET_HEIGHT, Math.round(height))),
  };
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const createNonce = (): string => {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

/** Builds a complete srcdoc document. The iframe itself must use sandbox="allow-scripts". */
export function buildSandboxWidgetDocument(widget: SandboxWidgetSource): string {
  const normalized = normalizeSandboxWidget(widget);
  if (!normalized) throw new TypeError("Unsafe sandbox widget source");

  const nonce = createNonce();
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src-attr 'none'",
    "connect-src 'none'",
    "img-src data:",
    "media-src 'none'",
    "font-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "navigate-to 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join("; ");
  const widgetId = JSON.stringify(normalized.id);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(normalized.title)}</title>
  <style nonce="${nonce}">
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
${normalized.css}
  </style>
</head>
<body>
${normalized.html}
  <script nonce="${nonce}">
    (() => {
      "use strict";
      const widgetId = ${widgetId};
      const reportInteraction = (event) => {
        if (!event.isTrusted) return;
        window.parent.postMessage({ type: "studyquest-widget-interacted", widgetId }, "*");
      };
      for (const eventName of ["pointerdown", "keydown", "input", "change"]) {
        document.addEventListener(eventName, reportInteraction, { capture: true });
      }
    })();
  </script>
  <script nonce="${nonce}">
${normalized.javascript}
  </script>
</body>
</html>`;
}
