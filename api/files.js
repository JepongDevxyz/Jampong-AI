const UPLOAD =
  "https://generativelanguage.googleapis.com/upload/v1beta/files";

function keys() {
  return (
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    ""
  )
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function read(req) {
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

function out(res, status, body) {
  res.statusCode = status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.end(JSON.stringify(body));
}

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    return out(res, 405, {
      error: "Method not allowed"
    });
  }

  let body;

  try {
    body = await read(req);
  } catch {
    return out(res, 400, {
      error: "Invalid JSON"
    });
  }

  const file = body.file || {};

  if (!file.name || !file.data) {
    return out(res, 400, {
      error: "Missing file data"
    });
  }

  const mime =
    file.type ||
    "application/octet-stream";

  const bytes = Buffer.from(
    file.data,
    "base64"
  );

  if (bytes.length > 50 * 1024 * 1024) {
    return out(res, 413, {
      error: "File exceeds 50 MB."
    });
  }

  const ks = keys();

  if (!ks.length) {
    return out(res, 500, {
      error:
        "GEMINI_API_KEYS is not configured in Vercel."
    });
  }

  let last = "";

  for (const key of ks) {
    try {
      /*
        Start resumable upload
      */
      const start = await fetch(UPLOAD, {
        method: "POST",

        headers: {
          "x-goog-api-key": key,

          "X-Goog-Upload-Protocol":
            "resumable",

          "X-Goog-Upload-Command":
            "start",

          "X-Goog-Upload-Header-Content-Length":
            String(bytes.length),

          "X-Goog-Upload-Header-Content-Type":
            mime,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          file: {
            display_name: file.name
          }
        })
      });

      if (!start.ok) {
        last = await start.text();

        if (
          [
            401,
            403,
            429,
            500,
            502,
            503,
            504
          ].includes(start.status)
        ) {
          continue;
        }

        return out(res, start.status, {
          error: last
        });
      }

      const uploadUrl =
        start.headers.get(
          "x-goog-upload-url"
        );

      if (!uploadUrl) {
        throw new Error(
          "Gemini upload URL was not returned."
        );
      }

      /*
        Upload actual bytes
      */
      const done = await fetch(uploadUrl, {
        method: "POST",

        headers: {
          "Content-Length":
            String(bytes.length),

          "X-Goog-Upload-Offset":
            "0",

          "X-Goog-Upload-Command":
            "upload, finalize",

          "Content-Type":
            mime
        },

        body: bytes
      });

      const result =
        await done.json().catch(() => ({}));

      if (!done.ok) {
        last =
          result.error?.message ||
          `HTTP ${done.status}`;

        if (
          [
            401,
            403,
            429,
            500,
            502,
            503,
            504
          ].includes(done.status)
        ) {
          continue;
        }

        return out(res, done.status, {
          error: last
        });
      }

      const uploaded =
        result.file || result;

      return out(res, 200, {
        ok: true,
        name: uploaded.name,
        uri: uploaded.uri,
        mimeType:
          uploaded.mimeType || mime,
        state:
          uploaded.state || "ACTIVE"
      });
    }

    catch (e) {
      last =
        e.message ||
        "Upload failed";
    }
  }

  return out(res, 502, {
    error:
      last ||
      "File upload failed."
  });
};
