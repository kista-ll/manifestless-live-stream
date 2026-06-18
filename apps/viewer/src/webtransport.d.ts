interface WebTransport {
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  close: () => void;
}

declare const WebTransport: {
  prototype: WebTransport;
  new (url: string): WebTransport;
};
