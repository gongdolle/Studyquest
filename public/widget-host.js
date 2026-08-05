(() => {
  "use strict";

  const root = document.getElementById("widget-root");
  const generatedStyle = document.getElementById("generated-style");
  const errorBox = document.getElementById("runtime-error");
  let widgetId = "";
  let instanceId = "";
  let messageNonce = "";
  let generatedScriptUrl = "";
  let generatedScriptElement = null;

  const cleanMessage = (value) => String(value ?? "위젯 실행 오류")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 500);

  const send = (type, detail = {}) => {
    window.parent.postMessage({
      protocol: "studyquest-widget/v1",
      type,
      widgetId,
      instanceId,
      nonce: messageNonce,
      ...detail,
    }, "*");
  };

  const showError = (value) => {
    const message = cleanMessage(value?.message ?? value);
    errorBox.textContent = message;
    errorBox.style.display = "block";
    send("studyquest-widget-error", { message });
  };

  const clearGeneratedScript = () => {
    generatedScriptElement?.remove();
    generatedScriptElement = null;
    if (generatedScriptUrl) URL.revokeObjectURL(generatedScriptUrl);
    generatedScriptUrl = "";
  };

  const isLoadMessage = (value) => Boolean(
    value
    && typeof value === "object"
    && value.type === "studyquest-widget-load"
    && value.protocol === "studyquest-widget/v1"
    && value.version === 1
    && typeof value.widgetId === "string"
    && value.widgetId.length > 0
    && value.widgetId.length <= 100
    && typeof value.instanceId === "string"
    && /^[0-9a-f-]{36}$/i.test(value.instanceId)
    && typeof value.nonce === "string"
    && /^[0-9a-f]{32}$/.test(value.nonce)
    && typeof value.html === "string"
    && value.html.length <= 20_000
    && typeof value.css === "string"
    && value.css.length <= 20_000
    && typeof value.javascript === "string"
    && value.javascript.length <= 30_000
    && (value.theme === "light" || value.theme === "dark")
  );

  const loadWidget = (payload) => {
    clearGeneratedScript();
    widgetId = payload.widgetId;
    instanceId = payload.instanceId;
    messageNonce = payload.nonce;
    document.documentElement.dataset.theme = payload.theme;
    errorBox.textContent = "";
    errorBox.style.display = "none";
    generatedStyle.textContent = payload.css;
    root.innerHTML = payload.html;

    const guardedSource = `"use strict";\n(() => {\n${payload.javascript}\n})();`;
    generatedScriptUrl = URL.createObjectURL(new Blob([guardedSource], { type: "text/javascript" }));
    generatedScriptElement = document.createElement("script");
    generatedScriptElement.src = generatedScriptUrl;
    generatedScriptElement.addEventListener("load", () => send("studyquest-widget-ready"), { once: true });
    generatedScriptElement.addEventListener("error", () => showError("생성된 JavaScript를 실행하지 못했습니다."), { once: true });
    document.body.append(generatedScriptElement);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !isLoadMessage(event.data)) return;
    try {
      loadWidget(event.data);
    } catch (error) {
      showError(error);
    }
  });

  window.addEventListener("error", (event) => showError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => showError(event.reason));

  for (const eventName of ["pointerdown", "input", "change", "keydown"]) {
    document.addEventListener(eventName, (event) => {
      if (!event.isTrusted) return;
      if (widgetId) send("studyquest-widget-interacted");
    }, { capture: true });
  }

  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
  }, { capture: true });
  document.addEventListener("submit", (event) => event.preventDefault(), { capture: true });
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());

  window.parent.postMessage({
    type: "studyquest-widget-host-ready",
    capabilities: {
      appBridge: typeof window.studyQuest !== "undefined",
      node: typeof window.process !== "undefined" || typeof window.require !== "undefined",
      origin: window.origin,
    },
  }, "*");
})();
