const port = Number(process.argv[2] ?? 9223);

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

const evaluated = await call("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const saved = await window.studyQuest.credentials.set({
      provider: 'openai',
      apiKey: 'test-runtime-smoke-placeholder-value',
      model: 'gpt-5.6-terra'
    });
    const providerStatus = await window.studyQuest.ai.status();
    const armed = await window.studyQuest.audio.armPermission();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const audioTracks = stream.getAudioTracks().length;
    const videoTracks = stream.getVideoTracks().length;
    stream.getTracks().forEach((track) => track.stop());
    const removed = await window.studyQuest.credentials.remove('openai');
    return {
      credentialSaved: saved.ok,
      credentialDecryptable: providerStatus.openai.decryptable,
      microphoneArmed: armed.ok,
      audioTracks,
      videoTracks,
      credentialRemoved: removed.ok
    };
  })()`,
});

socket.close();
const value = evaluated.result?.value;
if (!value?.credentialSaved || !value?.credentialDecryptable || !value?.microphoneArmed || value.audioTracks < 1 || value.videoTracks !== 0 || !value.credentialRemoved) {
  throw new Error(`Runtime smoke failed: ${JSON.stringify(value)}`);
}
console.log(JSON.stringify(value));
