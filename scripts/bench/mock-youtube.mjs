import { createHash } from "node:crypto";
import http from "node:http";

const port = Number(process.argv[2] ?? 0);
let last = null;
let sessions = 0;

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const json = (status, body, headers = {}) => {
    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/token") {
    request.resume();
    request.on("end", () => json(200, { access_token: "bench-access", expires_in: 3600 }));
    return;
  }
  if (url.pathname === "/bench/last") return json(200, last);
  if (url.pathname.startsWith("/upload/youtube/v3/videos") && request.method === "POST") {
    request.resume();
    sessions += 1;
    const session = `http://127.0.0.1:${server.address().port}/session/${sessions}`;
    request.on("end", () => json(200, {}, { location: session }));
    return;
  }
  if (url.pathname.startsWith("/session/") && request.method === "PUT") {
    const hash = createHash("sha256");
    let bytes = 0;
    const started = Date.now();
    request.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    request.on("end", () => {
      last = {
        bytes,
        sha256: hash.digest("hex"),
        contentLength: Number(request.headers["content-length"] ?? -1),
        chunked: request.headers["transfer-encoding"] === "chunked",
        ms: Date.now() - started
      };
      json(200, { id: `bench-${sessions}` });
    });
    return;
  }
  request.resume();
  request.on("end", () => json(200, { items: [] }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`MOCK_READY ${server.address().port}`);
});
