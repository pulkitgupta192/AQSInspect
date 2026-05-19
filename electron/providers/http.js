const https = require("https");
const { URL } = require("url");

function requestJson(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;

    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          "User-Agent": "AQS-Inspect",
          "Accept": "application/json",
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            // Do not leak secrets; caller controls headers.
            return reject(new Error(`HTTP ${status}: ${raw?.slice(0, 300)}`));
          }
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch (e) {
            reject(new Error("Failed to parse JSON response"));
          }
        });
      }
    );

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function requestText(url, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          "User-Agent": "AQS-Inspect",
          "Accept": "text/plain",
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            return reject(new Error(`HTTP ${status}: ${raw?.slice(0, 300)}`));
          }
          resolve(raw);
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

module.exports = { requestJson, requestText };
``