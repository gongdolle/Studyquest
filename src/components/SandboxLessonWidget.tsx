import { Code2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SandboxWidgetSource } from "../lib/sandbox-widget";

type RuntimeStatus = "loading" | "ready" | "error";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const createNonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16)))
  .map((value) => value.toString(16).padStart(2, "0"))
  .join("");

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && Object.keys(value).length === keys.length;
};

export function SandboxLessonWidget({
  widget,
  onExplore,
}: {
  widget: SandboxWidgetSource;
  onExplore(): void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<RuntimeStatus>("loading");
  const [error, setError] = useState("");
  const hostUrl = "studyquest-widget://runtime/index.html";
  const widgetIdentity = JSON.stringify(widget);
  const instanceId = useMemo(() => crypto.randomUUID(), [revision, widgetIdentity]);
  const messageNonce = useMemo(() => createNonce(), [revision, widgetIdentity]);
  const messageRate = useRef({ since: 0, count: 0 });

  const sendWidget = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({
      type: "studyquest-widget-load",
      protocol: "studyquest-widget/v1",
      version: 1,
      widgetId: widget.id,
      instanceId,
      nonce: messageNonce,
      html: widget.html,
      css: widget.css,
      javascript: widget.javascript,
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    }, "*");
  }, [instanceId, messageNonce, widgetIdentity]);

  useEffect(() => {
    setStatus("loading");
    setError("");
    sendWidget();
  }, [revision, sendWidget, widgetIdentity]);

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== "null" || !isRecord(event.data)) return;
      const type = event.data.type;
      if (type === "studyquest-widget-host-ready") {
        if (!hasOnlyKeys(event.data, ["type", "capabilities"])) return;
        const capabilities = isRecord(event.data.capabilities) ? event.data.capabilities : {};
        if (capabilities.appBridge === true || capabilities.node === true) {
          setStatus("error");
          setError("격리 검증에 실패해 생성 위젯을 중단했습니다.");
          return;
        }
        sendWidget();
        return;
      }
      const now = Date.now();
      if (now - messageRate.current.since > 1_000) messageRate.current = { since: now, count: 0 };
      messageRate.current.count += 1;
      if (messageRate.current.count > 30) return;
      if (
        event.data.protocol !== "studyquest-widget/v1"
        || event.data.widgetId !== widget.id
        || event.data.instanceId !== instanceId
        || event.data.nonce !== messageNonce
      ) return;
      if (type === "studyquest-widget-ready") {
        if (!hasOnlyKeys(event.data, ["protocol", "type", "widgetId", "instanceId", "nonce"])) return;
        setStatus("ready");
        return;
      }
      if (type === "studyquest-widget-interacted") {
        if (!hasOnlyKeys(event.data, ["protocol", "type", "widgetId", "instanceId", "nonce"])) return;
        onExplore();
        return;
      }
      if (type === "studyquest-widget-error") {
        if (!hasOnlyKeys(event.data, ["protocol", "type", "widgetId", "instanceId", "nonce", "message"])) return;
        setStatus("error");
        setError(typeof event.data.message === "string" ? event.data.message.slice(0, 500) : "위젯 실행 오류");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [instanceId, messageNonce, onExplore, sendWidget, widget.id]);

  return (
    <figure className="lesson-widget sandbox-widget" aria-labelledby={`${widget.id}-title`}>
      <figcaption>
        <span className="widget-kicker"><ShieldCheck size={14} /> AI 생성 · 격리 iframe</span>
        <strong id={`${widget.id}-title`}>{widget.title}</strong>
        <p>{widget.instruction}</p>
      </figcaption>
      <div className="sandbox-toolbar">
        <span className={`sandbox-status is-${status}`}>
          <i />{status === "loading" ? "실험실 준비 중" : status === "ready" ? "격리 실행 중" : "실행 중단"}
        </span>
        <button
          type="button"
          className="button"
          onClick={() => {
            setRevision((value) => value + 1);
            setStatus("loading");
            setError("");
          }}
        >
          <RefreshCw size={14} /> 초기화
        </button>
      </div>
      <div className="sandbox-frame-shell" style={{ minHeight: widget.height }}>
        <iframe
          key={revision}
          ref={frameRef}
          className="sandbox-frame"
          title={`${widget.title} 격리 실험실`}
          src={hostUrl}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="lazy"
          allow="accelerometer 'none'; autoplay 'none'; camera 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; encrypted-media 'none'; fullscreen 'none'; geolocation 'none'; gyroscope 'none'; microphone 'none'; midi 'none'; payment 'none'; publickey-credentials-get 'none'; screen-wake-lock 'none'; serial 'none'; usb 'none'; web-share 'none'"
          style={{ height: widget.height }}
          onLoad={sendWidget}
        />
        {status === "loading" && <div className="sandbox-frame-state"><span className="spinner" /> 위젯 코드를 격리하고 있습니다</div>}
        {status === "error" && <div className="sandbox-frame-state is-error"><ShieldCheck size={20} />{error}</div>}
      </div>
      <details className="sandbox-source">
        <summary><Code2 size={13} /> AI가 만든 코드 확인</summary>
        <div>
          <section><strong>HTML</strong><pre>{widget.html}</pre></section>
          <section><strong>CSS</strong><pre>{widget.css}</pre></section>
          <section><strong>JavaScript</strong><pre>{widget.javascript}</pre></section>
        </div>
      </details>
    </figure>
  );
}
