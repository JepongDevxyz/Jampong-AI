import { GoogleGenAI } from "@google/genai";

function getKeys() {
  const raw =
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    "";

  return raw
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function pickKey() {
  const keys = getKeys();

  if (!keys.length) {
    throw new Error("No Gemini API key configured.");
  }

  return keys[Math.floor(Math.random() * keys.length)];
}

function sendError(res, code, message) {
  return res.status(code).json({
    ok: false,
    error: message
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendError(res, 405, "POST only.");
  }

  try {
    const {
      prompt,
      image,
      mimeType = "image/png",
      aspectRatio = "1:1",
      imageSize = "1K"
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return sendError(res, 400, "Image prompt is required.");
    }

    if (prompt.length > 8000) {
      return sendError(res, 400, "Prompt is too long.");
    }

    if (image && image.length > 15_000_000) {
      return sendError(res, 413, "Image is too large.");
    }

    const ai = new GoogleGenAI({
      apiKey: pickKey()
    });

    const input = [];

    if (image) {
      input.push({
        type: "image",
        mime_type: mimeType,
        data: image
      });
    }

    input.push({
      type: "text",
      text: image
        ? `
Edit the supplied image according to this instruction:

${prompt}

Preserve the important original composition unless the instruction explicitly
requests a change. Return the edited image.
`
        : prompt
    });

    const interaction = await ai.interactions.create({
      model: "gemini-3.1-flash-image",
      input,
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: aspectRatio,
        image_size: imageSize
      }
    });

    let imageData = null;
    let outputMime = "image/png";
    let text = "";

    if (interaction.output_image) {
      imageData = interaction.output_image.data;
      outputMime =
        interaction.output_image.mime_type || "image/png";
    }

    if (!imageData && Array.isArray(interaction.steps)) {
      for (const step of interaction.steps) {
        if (step.type !== "model_output") continue;

        for (const block of step.content || []) {
          if (block.type === "image") {
            imageData = block.data;
            outputMime =
              block.mime_type || "image/png";
          }

          if (block.type === "text") {
            text += block.text || "";
          }
        }
      }
    }

    if (!imageData) {
      throw new Error("The image model did not return an image.");
    }

    return res.status(200).json({
      ok: true,
      image: imageData,
      mimeType: outputMime,
      text
    });

  } catch (error) {
    console.error("IMAGE ERROR:", error);

    return sendError(
      res,
      500,
      error?.message || "Image generation failed."
    );
  }
}
