import { Mic, ShieldCheck, Sparkles, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MAX_RECORDING_SECONDS = 120;

const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

const recorderMimeType = () => {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
};

const microphoneError = (error: unknown) => {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Windows 또는 앱에서 마이크 권한이 거부됐습니다.";
  if (name === "NotFoundError") return "사용할 수 있는 마이크를 찾지 못했습니다.";
  if (name === "NotReadableError") return "다른 앱이 마이크를 사용 중이거나 장치를 읽을 수 없습니다.";
  return error instanceof Error ? error.message : "마이크를 시작하지 못했습니다.";
};

export default function VoiceRecorder({
  transcriptionAvailable,
  onTranscript,
}: {
  transcriptionAvailable: boolean;
  onTranscript(text: string): void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef("");
  const timerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "preview" | "transcribing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [language, setLanguage] = useState("en");
  const [message, setMessage] = useState("");

  const clearTimers = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current);
    timerRef.current = null;
    maxTimerRef.current = null;
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    clearTimers();
  };

  const clearRecording = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
    setRecording(null);
    setElapsed(0);
    setMessage("");
    setPhase("idle");
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const stop = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseStream();
  };

  const start = async () => {
    setMessage("");
    if (!window.studyQuest || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("이 환경에서는 마이크 녹음을 사용할 수 없습니다.");
      return;
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
    setRecording(null);
    setElapsed(0);
    setPhase("requesting");
    try {
      await window.studyQuest.audio.armPermission();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = recorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setMessage("녹음 중 오류가 발생했습니다. 다시 녹음해 주세요.");
        releaseStream();
        setPhase("idle");
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        recorderRef.current = null;
        chunksRef.current = [];
        releaseStream();
        if (!mountedRef.current) return;
        if (blob.size < 64) {
          setMessage("녹음이 너무 짧습니다. 다시 말해 주세요.");
          setPhase("idle");
          return;
        }
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setRecording(blob);
        setPreviewUrl(url);
        setPhase("preview");
      };
      recorder.start(1_000);
      setPhase("recording");
      timerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1_000);
      maxTimerRef.current = window.setTimeout(stop, MAX_RECORDING_SECONDS * 1_000);
    } catch (error) {
      releaseStream();
      setPhase("idle");
      setMessage(microphoneError(error));
    }
  };

  const transcribe = async () => {
    if (!recording || !window.studyQuest || !transcriptionAvailable) return;
    setPhase("transcribing");
    setMessage("이 녹음만 OpenAI 전사 API로 보내고 있습니다…");
    try {
      const result = await window.studyQuest.audio.transcribe({
        bytes: await recording.arrayBuffer(),
        mimeType: recording.type || "audio/webm",
        language,
      });
      if (!result.ok || !result.text) throw new Error(result.error ?? "전사 결과가 없습니다.");
      onTranscript(result.text);
      setMessage("전사문을 답안 칸에 넣었습니다. 직접 고친 뒤 선택한 AI로 검증할 수 있습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPhase("preview");
    }
  };

  return (
    <div className={`voice-recorder${phase === "recording" ? " is-recording" : ""}`}>
      <div className="voice-heading">
        <div><strong><Mic size={14} /> 말로 답하기</strong><span>영어 회화·낭독·발표 연습에도 사용</span></div>
        <span className="voice-time">{formatDuration(elapsed)} / 02:00</span>
      </div>
      {phase === "recording" ? (
        <button className="button voice-stop" type="button" onClick={stop}><Square size={13} fill="currentColor" /> 녹음 끝내기</button>
      ) : phase === "requesting" ? (
        <button className="button" type="button" disabled>마이크 여는 중…</button>
      ) : !recording ? (
        <button className="button" type="button" onClick={() => void start()}><Mic size={14} /> 녹음 시작</button>
      ) : (
        <>
          <audio className="voice-preview" controls src={previewUrl} />
          <div className="voice-controls">
            <select className="select" value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="말한 언어">
              <option value="en">English</option>
              <option value="ko">한국어</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
            <button className="button mint" type="button" disabled={!transcriptionAvailable || phase === "transcribing"} onClick={() => void transcribe()}><Sparkles size={13} /> {phase === "transcribing" ? "전사 중…" : "전사해서 답안에 넣기"}</button>
            <button className="button danger icon-only" type="button" aria-label="녹음 지우기" onClick={clearRecording}><Trash2 size={13} /></button>
          </div>
        </>
      )}
      <p className="voice-privacy"><ShieldCheck size={12} /> 원음은 자동 저장하지 않습니다. 전사 버튼을 눌렀을 때만 OpenAI로 전송하며, 선택한 AI 평가는 전사문을 사용합니다.</p>
      {!transcriptionAvailable && <p className="voice-message">녹음·재생은 바로 됩니다. 자동 전사는 설정에서 OpenAI API를 연결하면 열립니다.</p>}
      {message && <p className="voice-message" role="status">{message}</p>}
    </div>
  );
}
