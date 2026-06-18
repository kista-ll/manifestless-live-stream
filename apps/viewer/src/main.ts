import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (app === null) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <main>
    <h1>Manifestless Live Viewer</h1>
    <dl>
      <div><dt>Connection</dt><dd>IDLE</dd></div>
      <div><dt>Player</dt><dd>IDLE</dd></div>
      <div><dt>Sequence</dt><dd>-</dd></div>
      <div><dt>Latency</dt><dd>-</dd></div>
      <div><dt>Buffer</dt><dd>-</dd></div>
      <div><dt>Viewers</dt><dd>- / 10</dd></div>
      <div><dt>Error</dt><dd>-</dd></div>
    </dl>
  </main>
`;
