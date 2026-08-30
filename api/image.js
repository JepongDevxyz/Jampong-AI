const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const IMAGE_MODEL =
  "gemini-3.1-flash-image";

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
    prompt,
    imageData = null,
    mimeType = null,
    aspectRatio = "1:1",
    imageSize = "1K"
  } = body || {};

  if (
    typeof prompt !== "string" ||
    !prompt.trim()
  ) {
    return Response.json(
      {
        ok: false,
        error: "Image prompt is required."
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

  const input = [];

  if (
    imageData &&
    typeof imageData === "string" &&
    mimeType &&
    mimeType.startsWith("image/")
  ) {
    input.push({
      type: "image",
      data: imageData,
      mime_type: mimeType
    });
  }

  input.push({
    type: "text",
    text: imageData
      ? `
Edit the supplied image according to this instruction:

${prompt.trim()}

Preserve important details unless the user explicitly asks
to change them.
`
      : prompt.trim()
  });

  const payload = {
    model: IMAGE_MODEL,
    input,
    response_format: {
      type: "image",
      aspect_ratio:
        aspectRatio,
      image_size:
        imageSize
    }
  };

  let response;

  try {
    response = await fetch(
      GEMINI_URL,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify(payload)
      }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          "Gemini image connection failed: " +
          error.message
      },
      { status: 502 }
    );
  }

  const data =
    await response.json();

  if (!response.ok) {
    return Response.json(
      {
        ok: false,
        error:
          data?.error?.message ||
          "Image generation failed.",
        details: data
      },
      {
        status: response.status
      }
    );
  }

  let image = null;
  let outputMime =
    "image/png";

  /*
   * Current Interactions schema:
   * steps -> model_output -> content -> image
   */

  for (
    const step of data.steps || []
  ) {
    if (
      step.type !==
      "model_output"
    ) {
      continue;
    }

    for (
      const block of
        step.content || []
    ) {
      if (
        block.type === "image" &&
        block.data
      ) {
        image =
          block.data;

        outputMime =
          block.mime_type ||
          "image/png";

        break;
      }
    }

    if (image) break;
  }

  /*
   * SDK/REST convenience-style fallback.
   */
  if (
    !image &&
    data.output_image?.data
  ) {
    image =
      data.output_image.data;

    outputMime =
      data.output_image.mime_type ||
      "image/png";
  }

  if (!image) {
    return Response.json(
      {
        ok: false,
        error:
          "Gemini completed the request but returned no image."
      },
      { status: 502 }
    );
  }

  return Response.json({
    ok: true,
    image,
    mimeType: outputMime
  });
}
