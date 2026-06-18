export const PROTOCOL_VERSION = 1;
export const FRAME_HEADER_SIZE = 32;
export const MAX_PAYLOAD_LENGTH = 10 * 1024 * 1024;

export type ControlMessage =
  | {
      type: "client_hello";
      protocolVersion: number;
      clientId: string;
      lastSequence: number | null;
    }
  | {
      type: "stream_init";
      protocolVersion: number;
      streamId: string;
      mimeType: string;
      segmentDurationMs: number;
      latestSequence: number;
      startSequence: number;
      targetLatencyMs: number;
      maxLatencyMs: number;
    }
  | { type: "segment_available"; sequence: number }
  | {
      type: "discontinuity";
      reason: string;
      nextSequence: number;
      requiresNewInitSegment: boolean;
    }
  | { type: "stream_ended"; lastSequence: number }
  | { type: "capacity_exceeded"; limit: number }
  | { type: "error"; code: string; message: string };

export type BinaryFrameType = "init" | "media";

export interface BinaryFrame {
  type: BinaryFrameType;
  sequence: number;
  ptsMs: number;
  durationMs: number;
  independent: boolean;
  payload: Uint8Array;
}

export class ProtocolError extends Error {}

export class ControlDecoder {
  private buffer = "";
  private readonly textDecoder = new TextDecoder();

  feed(chunk: Uint8Array): ControlMessage[] {
    this.buffer += this.textDecoder.decode(chunk, { stream: true });
    const messages: ControlMessage[] = [];

    while (this.buffer.includes("\n")) {
      const newline = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) {
        continue;
      }
      messages.push(parseControlMessage(JSON.parse(line)));
    }

    return messages;
  }
}

export function parseControlMessage(value: unknown): ControlMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new ProtocolError("control message must be an object with type");
  }
  return value as ControlMessage;
}

export function decodeBinaryFrame(data: Uint8Array): BinaryFrame {
  if (data.byteLength < FRAME_HEADER_SIZE) {
    throw new ProtocolError("binary frame is shorter than header");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  const version = view.getUint8(4);
  const rawType = view.getUint8(5);
  const flags = view.getUint16(6, false);
  const sequence = Number(view.getBigUint64(8, false));
  const ptsMs = Number(view.getBigUint64(16, false));
  const durationMs = view.getUint32(24, false);
  const payloadLength = view.getUint32(28, false);

  if (magic !== "MLSP") {
    throw new ProtocolError("invalid binary frame magic");
  }
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError("protocol version mismatch");
  }
  if (payloadLength > MAX_PAYLOAD_LENGTH) {
    throw new ProtocolError("payload exceeds 10 MiB limit");
  }
  if (data.byteLength - FRAME_HEADER_SIZE !== payloadLength) {
    throw new ProtocolError("payload length mismatch");
  }

  const type = rawType === 0x01 ? "init" : rawType === 0x02 ? "media" : null;
  if (type === null) {
    throw new ProtocolError("unknown binary frame type");
  }

  return {
    type,
    sequence,
    ptsMs,
    durationMs,
    independent: (flags & 0x01) === 0x01,
    payload: data.slice(FRAME_HEADER_SIZE),
  };
}
