const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const { readMultipart } = require("../middlewares/multipart");

test("a connection dropped mid-upload settles the reader instead of hanging", async (t) => {
  let settled;
  const outcome = new Promise((resolve) => {
    settled = resolve;
  });
  const server = http.createServer((req) => {
    readMultipart(req, { maxBytes: 1024 * 1024, allowedFields: ["transactionId"] }).then(
      () => settled("resolved"),
      (error) => settled(error.code),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const socket = net.connect(server.address().port, "127.0.0.1");
  await new Promise((resolve) => socket.once("connect", resolve));
  const boundary = "----escowear";
  socket.write(
    `POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 100000\r\n\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="proofImage"; filename="a.png"\r\nContent-Type: image/png\r\n\r\npartial`,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  socket.destroy();

  const result = await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve("pending"), 2000))]);
  assert.equal(result, "UPLOAD_ABORTED");
});
