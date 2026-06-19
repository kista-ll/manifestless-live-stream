import "./styles.css";
import { LatencyController } from "./latencyController";
import { MseController } from "./mseController";
import { ControlDecoder, decodeBinaryFrame, type BinaryFrame, type ControlMessage } from "./protocol";
import { SegmentReorderBuffer } from "./reorderBuffer";

const app = document.querySelector<HTMLDivElement>("#app");

if (app === null) {
  throw new Error("App root not found");
}
const appRoot = app;

appRoot.innerHTML = `
  <main>
    <h1>Manifestless Live Viewer</h1>
    <video id="video" muted autoplay playsinline controls></video>
    <dl>
      <div><dt>Connection</dt><dd id="connection">IDLE</dd></div>
      <div><dt>Player</dt><dd id="player">IDLE</dd></div>
      <div><dt>Sequence</dt><dd id="sequence">-</dd></div>
      <div><dt>Latency</dt><dd id="latency">-</dd></div>
      <div><dt>Buffer</dt><dd id="buffer">-</dd></div>
      <div><dt>Viewers</dt><dd id="viewers">- / 10</dd></div>
      <div><dt>Error</dt><dd id="error">-</dd></div>
    </dl>
  </main>
`;

const video = document.querySelector<HTMLVideoElement>("#video");

if (video === null) {
  throw new Error("Video element not found");
}
const videoElement = video;

const connectionEl = document.querySelector<HTMLElement>("#connection");
const playerEl = document.querySelector<HTMLElement>("#player");
const sequenceEl = document.querySelector<HTMLElement>("#sequence");
const latencyEl = document.querySelector<HTMLElement>("#latency");
const bufferEl = document.querySelector<HTMLElement>("#buffer");
const errorEl = document.querySelector<HTMLElement>("#error");

const params = new URLSearchParams(window.location.search);
const webTransportUrl =
  params.get("wt") ?? import.meta.env.VITE_WEBTRANSPORT_URL ?? "https://localhost:4433/webtransport/live-001";
const certHash = params.get("certHash");
const latencyController = new LatencyController();
let mseController: MseController | null = null;
let reorderBuffer = new SegmentReorderBuffer();
let initAppended = false;
const pendingFramesBeforeInit: BinaryFrame[] = [];
const pendingMedia: BinaryFrame[] = [];
let expectedTransportCloseCode: number | null = null;

function setText(element: HTMLElement | null, text: string): void {
  if (element !== null) {
    element.textContent = text;
  }
}

function setDataset(key: string, value: string): void {
  appRoot.dataset[key] = value;
}

function updateStatus(key: string, value: string): void {
  setDataset(key, value);
  if (key === "connection") {
    setText(connectionEl, value);
  } else if (key === "player") {
    setText(playerEl, value);
  } else if (key === "sequence") {
    setText(sequenceEl, value);
  } else if (key === "error") {
    setText(errorEl, value);
  }
}

function certOptions(): ConstructorParameters<typeof WebTransport>[1] {
  if (certHash === null) {
    return undefined;
  }
  const raw = Uint8Array.from(atob(certHash), (char) => char.charCodeAt(0));
  return {
    serverCertificateHashes: [{ algorithm: "sha-256", value: raw.buffer }],
  };
}

async function readStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    if (value !== undefined) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

async function initializeMse(message: Extract<ControlMessage, { type: "stream_init" }>): Promise<void> {
  const mediaSource = new MediaSource();
  videoElement.src = URL.createObjectURL(mediaSource);
  reorderBuffer = new SegmentReorderBuffer();
  reorderBuffer.reset(message.startSequence);
  initAppended = false;
  mseController = null;
  await new Promise<void>((resolve) => {
    mediaSource.addEventListener("sourceopen", () => resolve(), { once: true });
  });
  mseController = new MseController(mediaSource);
  mseController.initialize(message.mimeType);
  updateStatus("player", "BUFFERING");
  for (const frame of pendingFramesBeforeInit.splice(0)) {
    appendFrame(frame);
  }
}

function appendFrame(frame: BinaryFrame): void {
  if (mseController === null) {
    pendingFramesBeforeInit.push(frame);
    return;
  }
  if (frame.type === "init") {
    mseController.append(frame);
    initAppended = true;
    setDataset("initReceived", "true");
    for (const media of pendingMedia.splice(0)) {
      appendFrame(media);
    }
    return;
  }
  if (!initAppended) {
    pendingMedia.push(frame);
    return;
  }
  const result = reorderBuffer.push(frame, performance.now());
  for (const ready of result.ready) {
    mseController.append(ready);
    if (appRoot.dataset.firstMediaSequence === undefined) {
      setDataset("firstMediaSequence", String(ready.sequence));
    }
    updateStatus("sequence", ready.sequence.toString().padStart(6, "0"));
    setDataset("mediaReceived", "true");
  }
  void videoElement.play().then(() => updateStatus("player", "PLAYING")).catch(() => {
    updateStatus("player", "BUFFERING");
  });
}

function handleControl(message: ControlMessage): void {
  setDataset("lastControlType", message.type);
  if (message.type === "stream_init") {
    setDataset("latestSequence", String(message.latestSequence));
    setDataset("startSequence", String(message.startSequence));
    void initializeMse(message);
  } else if (message.type === "stream_ended") {
    updateStatus("player", "ENDED");
    mseController?.endWhenIdle();
  } else if (message.type === "capacity_exceeded") {
    setDataset("capacityLimit", String(message.limit));
    expectedTransportCloseCode = 0x101;
    setDataset("expectedTransportCloseCode", String(expectedTransportCloseCode));
    setDataset("transportCloseCode", String(expectedTransportCloseCode));
    updateStatus("error", "capacity_exceeded");
  } else if (message.type === "error") {
    updateStatus("error", message.message);
  }
}

async function start(): Promise<void> {
  updateStatus("connection", "CONNECTING");
  const transport = new WebTransport(webTransportUrl, certOptions());
  await transport.ready;
  updateStatus("connection", "CONNECTED");
  setDataset("webtransportReady", "true");
  void transport.closed
    .then((closeInfo) => {
      setDataset("transportClosed", "true");
      setDataset("transportCloseCode", String(closeInfo.closeCode || expectedTransportCloseCode || ""));
      updateStatus("connection", "CLOSED");
    })
    .catch((error: unknown) => {
      setDataset("transportClosed", "true");
      const rawCloseCode =
        typeof error === "object" && error !== null && "closeCode" in error
          ? (error as { closeCode: unknown }).closeCode
          : typeof error === "object" && error !== null && "streamErrorCode" in error
            ? (error as { streamErrorCode: unknown }).streamErrorCode
            : null;
      const closeCode =
        rawCloseCode !== null && rawCloseCode !== undefined
          ? String(rawCloseCode)
          : expectedTransportCloseCode !== null
            ? String(expectedTransportCloseCode)
            : "";
      if (closeCode !== "") {
        setDataset("transportCloseCode", closeCode);
      }
      updateStatus("connection", "CLOSED");
    });

  const control = await transport.createBidirectionalStream();
  const writer = control.writable.getWriter();
  const clientId = crypto.randomUUID();
  await writer.write(
    new TextEncoder().encode(
      JSON.stringify({
        type: "client_hello",
        protocolVersion: 1,
        clientId,
        lastSequence: null,
      }) + "\n",
    ),
  );
  writer.releaseLock();

  const controlDecoder = new ControlDecoder();
  void (async () => {
    const reader = control.readable.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        for (const message of controlDecoder.feed(value)) {
          handleControl(message);
        }
      }
    }
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setDataset("controlReaderError", message);
  });

  void (async () => {
    const reader = transport.incomingUnidirectionalStreams.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        appendFrame(decodeBinaryFrame(await readStream(value)));
      }
    }
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setDataset("mediaReaderError", message);
  });

  window.setInterval(() => {
    const snapshot = latencyController.update(videoElement);
    setDataset("latencySeconds", snapshot.latency.toFixed(3));
    setText(latencyEl, `${snapshot.latency.toFixed(1)}s`);
    if (videoElement.buffered.length > 0) {
      const buffered =
        videoElement.buffered.end(videoElement.buffered.length - 1) - videoElement.currentTime;
      setText(bufferEl, `${buffered.toFixed(1)}s`);
    }
  }, 500);
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  updateStatus("connection", "CLOSED");
  updateStatus("player", "ERROR");
  updateStatus("error", message);
});
