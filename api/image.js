// api/image.js
// Jampong AI - Production Image Generation / Editing
// Vercel Serverless Function
//
// Environment:
// GEMINI_API_KEYS=key1,key2,key3,key4
//
// Optional:
// GEMINI_IMAGE_MODELS=gemini-3.1-flash-image,gemini-3.1-flash-lite-image
//
// Requires:
// @google/genai is NOT required by this endpoint.
// This implementation uses the current Gemini Interactions REST API
// directly to avoid SDK/schema mismatch issues.

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

const PRIMARY_MODEL = "gemini-3.1-flash-image";
const FALLBACK_MODEL = "gemini-3.1-flash-lite-image";

const DEFAULT_MODELS = [
  PRIMARY_MODEL,
  FALLBACK_MODEL,
];

const RETRYABLE_STATUS = new Set([
  408,
  429,
  500,
  502,
  503,
  504,
]);

const MAX_RETRIES_PER_KEY = 2;

function getKeys() {
  const raw = process.env.GEMINI_API_KEYS || "";

  return raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function getModels() {
  const raw = process.env.GEMINI_IMAGE_MODELS;

  if (!raw) {
    return DEFAULT_MODELS;
  }

  const models = raw
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length ? models : DEFAULT_MODELS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function backoffDelay(attempt) {
  const base = 700 * Math.pow(2, attempt);
  const jitter = randomInt(500);

  return Math.min(base + jitter, 6000);
}

function getStatus(error) {
  if (!error) return null;

  if (typeof error.status === "number") {
    return error.status;
  }

  if (typeof error.code === "number") {
    return error.code;
  }

  return null;
}

function isRetryableStatus(status) {
  return RETRYABLE_STATUS.has(status);
}

function isQuotaError(status, message = "") {
  const text = String(message).toLowerCase();

  return (
    status === 429 ||
    text.includes("quota exceeded") ||
    text.includes("resource_exhausted") ||
    text.includes("rate limit") ||
    text.includes("limit: 0")
  );
}

function isModelNotFound(status, message = "") {
  const text = String(message).toLowerCase();

  return (
    status === 404 ||
    text.includes("model not found") ||
    text.includes("not found")
  );
}

function isAuthError(status) {
  return status === 401 || status === 403;
}

function extractErrorMessage(data) {
  if (!data) {
    return "Unknown Gemini API error.";
  }

  if (typeof data.message === "string") {
    return data.message;
  }

  if (data.error?.message) {
    return data.error.message;
  }

  try {
    return JSON.stringify(data);
  } catch {
    return "Unknown Gemini API error.";
  }
}

function cleanBase64(value) {
  if (!value) return "";

  if (typeof value !== "string") {
    return "";
  }

  // Accept both:
  // data:image/png;base64,XXXX
  // XXXX
  if (value.includes(",")) {
    return value.split(",").pop().trim();
  }

  return value.trim();
}

function normalizeMimeType(mimeType) {
  const allowed = [
    "image/png",
    "image/jpeg",
    "image/webp",
  ];

  if (allowed.includes(mimeType)) {
    return mimeType;
  }

  return "image/jpeg";
}

function normalizeAspectRatio(value) {
  const allowed = [
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
    "1:4",
    "4:1",
    "1:8",
    "8:1",
  ];

  return allowed.includes(value) ? value : "1:1";
}

function normalizeImageSize(value, model) {
  const requested =
    value === "512px" ||
    value === "0.5K"
      ? "512px"
      : value === "2K"
        ? "2K"
        : value === "4K"
          ? "4K"
          : "1K";

  /*
   * Gemini 3.1 Flash Lite Image only supports 1K.
   */
  if (model === FALLBACK_MODEL) {
    return "1K";
  }

  return requested;
}

function normalizeImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .filter(Boolean)
    .slice(0, 5)
    .map((image) => {
      const data =
        typeof image.data === "string"
          ? cleanBase64(image.data)
          : "";

      if (!data) {
        return null;
      }

      return {
        type: "image",
        mime_type: normalizeMimeType(image.mime_type),
        data,
      };
    })
    .filter(Boolean);
}

function buildInput(prompt, images) {
  const textPart = {
    type: "text",
    text: prompt,
  };

  if (!images.length) {
    return [textPart];
  }

  /*
   * Google documents image editing using an input array
   * containing image parts + text instructions.
   */
  return [
    ...images,
    textPart,
  ];
}

function friendlyError({
  status,
  quota,
  model,
}) {
  if (quota) {
    return {
      code: "IMAGE_QUOTA_EXCEEDED",
      message:
        "Image generation is temporarily unavailable because the Gemini image quota for this project has been reached. Please try again later or check your Gemini API billing/rate limits.",
      retryable: true,
      model,
      status,
    };
  }

  if (status === 503) {
    return {
      code: "IMAGE_SERVICE_BUSY",
      message:
        "The Gemini image service is temporarily busy. Please try again in a moment.",
      retryable: true,
      model,
      status,
    };
  }

  if (status === 429) {
    return {
      code: "IMAGE_RATE_LIMITED",
      message:
        "Too many image requests were made recently. Please wait a moment and try again.",
      retryable: true,
      model,
      status,
    };
  }

  return {
    code: "IMAGE_GENERATION_FAILED",
    message:
      "Jampong AI could not generate the image right now. Please try again.",
    retryable: true,
    model,
    status,
  };
}

async function callGemini({
  apiKey,
  model,
  prompt,
  images,
  aspectRatio,
  imageSize,
}) {
  const input = buildInput(prompt, images);

  const responseFormat = {
    type: "image",
    aspect_ratio: normalizeAspectRatio(aspectRatio),
  };

  /*
   * Lite image model only supports 1K.
   */
  if (model === PRIMARY_MODEL) {
    responseFormat.image_size = normalizeImageSize(
      imageSize,
      model
    );
  } else {
    responseFormat.image_size = "1K";
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        input,
        response_format: responseFormat,
      }),
    }
  );

  const rawText = await response.text();

  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    data = {
      error: {
        message: rawText || "Invalid Gemini response.",
      },
    };
  }

  if (!response.ok) {
    const error = new Error(
      extractErrorMessage(data)
    );

    error.status = response.status;
    error.body = data;

    throw error;
  }

  return data;
}

function extractGeneratedImage(interaction) {
  /*
   * Current Gemini Interactions API can expose generated
   * image through output_image.
   */
  if (
    interaction?.output_image &&
    typeof interaction.output_image.data === "string"
  ) {
    return {
      data: interaction.output_image.data,
      mimeType:
        interaction.output_image.mime_type ||
        "image/png",
    };
  }

  /*
   * Also support the documented steps[].content[] format.
   */
  if (Array.isArray(interaction?.steps)) {
    for (const step of interaction.steps) {
      if (
        step?.type !== "model_output" ||
        !Array.isArray(step.content)
      ) {
        continue;
      }

      for (const content of step.content) {
        if (
          content?.type === "image" &&
          typeof content.data === "string"
        ) {
          return {
            data: content.data,
            mimeType:
              content.mime_type ||
              "image/png",
          };
        }
      }
    }
  }

  return null;
}

function extractOutputText(interaction) {
  if (
    typeof interaction?.output_text === "string"
  ) {
    return interaction.output_text;
  }

  if (!Array.isArray(interaction?.steps)) {
    return "";
  }

  const texts = [];

  for (const step of interaction.steps) {
    if (
      step?.type !== "model_output" ||
      !Array.isArray(step.content)
    ) {
      continue;
    }

    for (const content of step.content) {
      if (
        content?.type === "text" &&
        typeof content.text === "string"
      ) {
        texts.push(content.text);
      }
    }
  }

  return texts.join("\n").trim();
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed.",
    });
  }

  const keys = getKeys();
  const models = getModels();

  if (!keys.length) {
    return res.status(500).json({
      error:
        "GEMINI_API_KEYS is missing from Vercel Environment Variables.",
    });
  }

  let body;

  try {
    body =
      typeof req.body === "object"
        ? req.body
        : JSON.parse(req.body || "{}");
  } catch {
    return res.status(400).json({
      error: "Invalid JSON request body.",
    });
  }

  const prompt =
    typeof body.prompt === "string"
      ? body.prompt.trim()
      : "";

  if (!prompt) {
    return res.status(400).json({
      error: "Image prompt is required.",
    });
  }

  if (prompt.length > 10000) {
    return res.status(400).json({
      error:
        "Image prompt is too long. Please keep it under 10,000 characters.",
    });
  }

  const images = normalizeImages(body.images);

  /*
   * Also accept one image from older frontend implementations.
   */
  if (
    !images.length &&
    typeof body.image === "string"
  ) {
    images.push({
      type: "image",
      mime_type: normalizeMimeType(
        body.mime_type
      ),
      data: cleanBase64(body.image),
    });
  }

  const aspectRatio = normalizeAspectRatio(
    body.aspectRatio
  );

  const requestedSize =
    body.imageSize ||
    body.size ||
    "1K";

  /*
   * Random starting key.
   */
  const startKeyIndex = randomInt(keys.length);

  let lastError = null;
  let lastModel = models[0];

  /*
   * MODEL FALLBACK
   *
   * Primary:
   * gemini-3.1-flash-image
   *
   * Fallback:
   * gemini-3.1-flash-lite-image
   */
  for (
    let modelIndex = 0;
    modelIndex < models.length;
    modelIndex++
  ) {
    const model = models[modelIndex];

    lastModel = model;

    for (
      let keyOffset = 0;
      keyOffset < keys.length;
      keyOffset++
    ) {
      const keyIndex =
        (startKeyIndex + keyOffset) % keys.length;

      const apiKey = keys[keyIndex];

      for (
        let attempt = 0;
        attempt <= MAX_RETRIES_PER_KEY;
        attempt++
      ) {
        try {
          if (attempt > 0) {
            await sleep(
              backoffDelay(attempt - 1)
            );
          }

          const interaction =
            await callGemini({
              apiKey,
              model,
              prompt,
              images,
              aspectRatio,
              imageSize: requestedSize,
            });

          const generated =
            extractGeneratedImage(
              interaction
            );

          if (!generated) {
            throw Object.assign(
              new Error(
                "Gemini completed the request but returned no image."
              ),
              {
                status: 502,
              }
            );
          }

          const latencyMs =
            Date.now() - startedAt;

          /*
           * Return the image as JSON.
           *
           * The browser can directly use:
           * data:image/png;base64,...
           */
          return res.status(200).json({
            ok: true,

            model,

            fallbackUsed:
              model !== PRIMARY_MODEL,

            mimeType:
              generated.mimeType,

            image:
              `data:${generated.mimeType};base64,${generated.data}`,

            base64:
              generated.data,

            text:
              extractOutputText(
                interaction
              ),

            aspectRatio,

            imageSize:
              normalizeImageSize(
                requestedSize,
                model
              ),

            latencyMs,
          });
        } catch (error) {
          lastError = error;

          const status =
            getStatus(error);

          const message =
            error?.message ||
            "Gemini image request failed.";

          console.error(
            JSON.stringify({
              type:
                "gemini_image_error",
              model,
              keySlot:
                keyIndex + 1,
              attempt,
              status,
              message,
            })
          );

          /*
           * Invalid API key:
           * immediately try another key.
           */
          if (isAuthError(status)) {
            break;
          }

          /*
           * Invalid/unavailable model:
           * immediately move to fallback model.
           */
          if (
            isModelNotFound(
              status,
              message
            )
          ) {
            break;
          }

          /*
           * Quota/rate limit:
           *
           * Retry briefly, then move to another key/model.
           */
          if (
            isQuotaError(
              status,
              message
            )
          ) {
            if (
              attempt <
              MAX_RETRIES_PER_KEY
            ) {
              continue;
            }

            break;
          }

          /*
           * Temporary server failure.
           */
          if (
            isRetryableStatus(status)
          ) {
            if (
              attempt <
              MAX_RETRIES_PER_KEY
            ) {
              continue;
            }

            break;
          }

          /*
           * Other error:
           * don't endlessly retry.
           */
          break;
        }
      }
    }
  }

  const status =
    getStatus(lastError);

  const message =
    lastError?.message || "";

  const quota =
    isQuotaError(
      status,
      message
    );

  const errorResponse =
    friendlyError({
      status,
      quota,
      model: lastModel,
    });

  return res.status(
    quota ? 429 : 503
  ).json({
    ok: false,

    error:
      errorResponse.message,

    code:
      errorResponse.code,

    retryable:
      errorResponse.retryable,

    model:
      errorResponse.model,

    latencyMs:
      Date.now() - startedAt,
  });
}
