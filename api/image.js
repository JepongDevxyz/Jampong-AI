const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const MODEL = "gemini-3.1-flash-image";

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

  let b;

  try {
    b = await read(req);
  } catch {
    return out(res, 400, {
      error: "Invalid JSON"
    });
  }

  if (!b.prompt) {
    return out(res, 400, {
      error: "Prompt required"
    });
  }

  const ks = keys();

  if (!ks.length) {
    return out(res, 500, {
      error:
        "GEMINI_API_KEYS is not configured in Vercel."
    });
  }

  const ratios = [
    "1:1",
    "16:9",
    "4:3",
    "3:4",
    "9:16",
    "1:4",
    "4:1",
    "1:8",
    "8:1"
  ];

  const ratio = ratios.includes(b.aspectRatio)
    ? b.aspectRatio
    : "1:1";

  const sizes = [
    "1K",
    "2K",
    "4K"
  ];

  const size = sizes.includes(b.imageSize)
    ? b.imageSize
    : "1K";

  const input = [
    {
      type: "text",
      text: String(b.prompt).slice(0, 20000)
    }
  ];

  /*
    Image editing
  */
  if (b.imageData) {
    const mime = String(
      b.imageMimeType || ""
    );

    if (!mime.startsWith("image/")) {
      return out(res, 400, {
        error: "Invalid image MIME type."
      });
    }

    input.push({
      type: "image",
      data: b.imageData,
      mime_type: mime
    });
  }

  let last = "";

  for (const key of ks) {
    try {
      const payload = {
        model: MODEL,

        input,

        response_format: {
          type: "image",
          mime_type: "image/jpeg",
          aspect_ratio: ratio,
          image_size: size
        }
      };

      const r = await fetch(ENDPOINT, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },

        body: JSON.stringify(payload)
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        last =
          j.error?.message ||
          `HTTP ${r.status}`;

        if (
          [
            401,
            403,
            429,
            500,
            502,
            503,
            504
          ].includes(r.status)
        ) {
          continue;
        }

        return out(res, r.status, {
          error: last
        });
      }

      /*
        Current output_image format
      */
      if (j.output_image?.data) {
        return out(res, 200, {
          data: j.output_image.data,
          mimeType:
            j.output_image.mime_type ||
            "image/jpeg"
        });
      }

      /*
        Compatibility with step-based response
      */
      for (const step of j.steps || []) {
        for (const content of step.content || []) {
          if (
            content.type === "image" &&
            content.data
          ) {
            return out(res, 200, {
              data: content.data,
              mimeType:
                content.mime_type ||
                "image/jpeg"
            });
          }
        }
      }

      return out(res, 502, {
        error:
          "The image model returned no image."
      });
    }

    catch (e) {
      last =
        e.message ||
        "Network error";
    }
  }

  return out(res, 502, {
    error:
      last ||
      "Image generation failed."
  });
};
