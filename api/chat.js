const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse";

const MODEL = "gemini-3.7-flash";

function getKeys() {
  return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";

    req.on("data", c => (s += c));

    req.on("end", () => {
      try {
        resolve(JSON.parse(s || "{}"));
      } catch (e) {
        reject(e);
      }
    });

    req.on("error", reject);
  });
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function safeText(x) {
  return String(x || "").slice(0, 300000);
}

function makeInput(body) {
  const parts = [];

  if (body.message) {
    parts.push({
      type: "text",
      text: safeText(body.message)
    });
  }

  for (const f of body.files || []) {
    if (!f?.data && !f?.uri) continue;

    const mime = f.type || f.mimeType || "application/octet-stream";

    /*
      Gemini Files API URI
    */
    if (f.uri) {
      if (mime.startsWith("image/")) {
        parts.push({
          type: "image",
          uri: f.uri,
          mime_type: mime
        });
      } else {
        parts.push({
          type: "document",
          uri: f.uri,
          mime_type: mime
        });
      }

      continue;
    }

    /*
      Small inline images
    */
    if (mime.startsWith("image/")) {
      parts.push({
        type: "image",
        data: f.data,
        mime_type: mime
      });

      continue;
    }

    /*
      Small inline PDF
    */
    if (mime === "application/pdf") {
      parts.push({
        type: "document",
        data: f.data,
        mime_type: mime
      });

      continue;
    }

    /*
      Text/code files
    */
    let text = "";

    try {
      text = Buffer.from(f.data, "base64").toString("utf8");
    } catch {}

    parts.push({
      type: "text",
      text:
        `\n--- FILE: ${f.name || "attachment"} ---\n` +
        safeText(text) +
        "\n--- END FILE ---"
    });
  }

  return parts.length === 1 ? parts[0].text : parts;
}

function sendSSE(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

module.exports = async function (req, res) {
  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      model: MODEL,
      time: Date.now()
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, {
      error: "Method not allowed"
    });
  }

  let body;

  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, {
      error: "Invalid JSON"
    });
  }

  const keys = getKeys();

  if (!keys.length) {
    return json(res, 500, {
      error: "GEMINI_API_KEYS is not configured in Vercel."
    });
  }

  /*
    Rotate:
    key1 -> key2 -> key3 -> key4 -> key1
  */
  const start = Date.now() % keys.length;

  let upstream = null;
  let lastError = "";

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];

    try {
      const payload = {
        model: MODEL,
        input: makeInput(body),
        stream: true,

        generation_config: {
          thinking_level: ["low", "medium", "high"].includes(body.thinking)
            ? body.thinking
            : "medium"
        }
      };

      if (body.webSearch) {
        payload.tools = [
          {
            type: "google_search"
          }
        ];
      }

      const r = await fetch(ENDPOINT, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "x-goog-api-key": key
        },

        body: JSON.stringify(payload)
      });

      if (r.ok) {
        upstream = r;
        break;
      }

      lastError = await r.text();

      if (
        ![
          400,
          401,
          403,
          408,
          429,
          500,
          502,
          503,
          504
        ].includes(r.status)
      ) {
        break;
      }
    } catch (e) {
      lastError = e.message || "Network error";
    }
  }

  if (!upstream) {
    let message = lastError || "Gemini request failed.";

    try {
      const x = JSON.parse(lastError);
      message = x.error?.message || message;
    } catch {}

    return json(res, 502, {
      error: message
    });
  }

  res.statusCode = 200;

  res.setHeader(
    "Content-Type",
    "text/event-stream; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache, no-transform"
  );

  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (res.flushHeaders) {
    res.flushHeaders();
  }

  sendSSE(res, {
    type: "status",
    text: "Thinking…"
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, {
        stream: true
      });

      const events = buffer.split(/\r?\n\r?\n/);

      buffer = events.pop() || "";

      for (const block of events) {
        let eventName = "";
        const data = [];

        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data.push(line.slice(5).trim());
          }
        }

        if (!data.length) continue;

        const raw = data.join("");

        if (!raw || raw === "[DONE]") continue;

        let event;

        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }

        const type =
          eventName ||
          event.event_type ||
          "";

        /*
          Current Gemini Interactions API
        */

        if (type === "step.start") {
          const step = event.step || {};

          if (step.type === "thought") {
            sendSSE(res, {
              type: "status",
              text: "Thinking…"
            });
          }

          else if (step.type === "model_output") {
            sendSSE(res, {
              type: "status",
              text: "Solving…"
            });
          }

          else if (step.type === "tool_call") {
            sendSSE(res, {
              type: "status",
              text: "Finding…"
            });
          }
        }

        else if (type === "step.delta") {
          const delta = event.delta || {};

          if (
            delta.type === "text" &&
            delta.text
          ) {
            sendSSE(res, {
              type: "text",
              text: delta.text
            });
          }

          else if (
            delta.type === "thought_summary"
          ) {
            sendSSE(res, {
              type: "status",
              text: "Thinking…"
            });
          }
        }

        else if (
          type === "interaction.requires_action"
        ) {
          sendSSE(res, {
            type: "status",
            text: "Analyzing…"
          });
        }

        else if (
          type === "interaction.completed"
        ) {
          sendSSE(res, {
            type: "done"
          });
        }

        else if (
          type === "error" ||
          type === "interaction.failed"
        ) {
          sendSSE(res, {
            type: "error",
            error:
              event.error?.message ||
              event.message ||
              "Gemini interaction failed."
          });
        }
      }
    }

    sendSSE(res, {
      type: "done"
    });
  }

  catch (e) {
    try {
      sendSSE(res, {
        type: "error",
        error: e.message || "Stream interrupted."
      });
    } catch {}
  }

  finally {
    res.end();
  }
};
