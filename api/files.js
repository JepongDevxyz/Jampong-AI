const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const MODEL =
  "gemini-3.7-flash";

let keyIndex = 0;

function getKeys() {
  return (
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    ""
  )
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);
}

function nextKey() {
  const keys = getKeys();

  if (!keys.length) {
    throw new Error(
      "GEMINI_API_KEYS is not configured."
    );
  }

  const key =
    keys[keyIndex % keys.length];

  keyIndex =
    (keyIndex + 1) % keys.length;

  return key;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return Response.json(
      {
        ok: false,
        error: "POST method required."
      },
      { status: 405 }
    );
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Invalid JSON."
      },
      { status: 400 }
    );
  }

  const {
    prompt = "Analyze this file and explain the important information.",
    file
  } = body || {};

  if (
    !file?.data ||
    !file?.mimeType
  ) {
    return Response.json(
      {
        ok: false,
        error: "A file is required."
      },
      { status: 400 }
    );
  }

  let key;

  try {
    key = nextKey();
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error.message
      },
      { status: 500 }
    );
  }

  const mime =
    String(file.mimeType);

  const input = [
    {
      type: "text",
      text: String(prompt)
    }
  ];

  if (
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime === "application/json"
  ) {
    input.push({
      type: "document",
      data: file.data,
      mime_type: mime
    });
  } else if (
    mime.startsWith("image/")
  ) {
    input.push({
      type: "image",
      data: file.data,
      mime_type: mime
    });
  } else {
    return Response.json(
      {
        ok: false,
        error:
          `Unsupported file type: ${mime}`
      },
      { status: 400 }
    );
  }

  const response =
    await fetch(
      GEMINI_URL,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          model: MODEL,
          input,
          store: false,
          generation_config: {
            thinking_level: "medium"
          }
        })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    return Response.json(
      {
        ok: false,
        error:
          data?.error?.message ||
          "File analysis failed."
      },
      {
        status: response.status
      }
    );
  }

  let text =
    data.output_text || "";

  if (!text) {
    for (
      const step of data.steps || []
    ) {
      for (
        const block of
          step.content || []
      ) {
        if (
          block.type === "text"
        ) {
          text += block.text || "";
        }
      }
    }
  }

  return Response.json({
    ok: true,
    text
  });
}
