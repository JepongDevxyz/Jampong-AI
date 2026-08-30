import { GoogleGenAI } from "@google/genai";

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

function getRandomKey() {
  const keys = getKeys();

  if (!keys.length) {
    throw new Error(
      "GEMINI_API_KEYS is not configured."
    );
  }

  return keys[
    Math.floor(Math.random() * keys.length)
  ];
}

function errorResponse(res, status, message) {
  return res.status(status).json({
    ok: false,
    error: message
  });
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return errorResponse(
      res,
      405,
      "POST method required."
    );
  }

  try {

    const {
      prompt,
      image,
      mimeType,
      aspectRatio = "1:1",
      imageSize = "1K"
    } = req.body || {};

    if (
      !prompt ||
      typeof prompt !== "string" ||
      !prompt.trim()
    ) {
      return errorResponse(
        res,
        400,
        "Image prompt is required."
      );
    }

    const ai = new GoogleGenAI({
      apiKey: getRandomKey()
    });

    const input = [];

    /*
      If an image was supplied, Gemini receives it
      as an image content block for editing.
    */

    if (image) {

      const safeMime =
        [
          "image/jpeg",
          "image/png",
          "image/webp"
        ].includes(mimeType)
          ? mimeType
          : "image/jpeg";

      input.push({
        type: "image",
        data: image,
        mime_type: safeMime
      });

    }

    input.push({
      type: "text",
      text: image
        ? `
Edit the supplied image according to the following instruction.

${prompt}

Keep the original subject and important details
unless the user explicitly asks to change them.
Return the edited image.
`
        : prompt
    });

    /*
      Current Gemini image API.
      JPEG is intentionally used because the API
      currently rejects image/png in this response
      configuration on the deployed endpoint.
    */

    const interaction =
      await ai.interactions.create({

        model:
          "gemini-3.1-flash-image",

        input,

        response_format: {
          type: "image",
          mime_type: "image/jpeg",
          aspect_ratio: aspectRatio,
          image_size: imageSize
        }

      });

    let outputImage = null;

    /*
      SDK convenience property.
    */

    if (interaction.output_image) {
      outputImage =
        interaction.output_image.data;
    }

    /*
      Fallback: inspect model_output steps.
    */

    if (!outputImage) {

      for (
        const step of interaction.steps || []
      ) {

        if (
          step.type !== "model_output"
        ) {
          continue;
        }

        for (
          const block of step.content || []
        ) {

          if (
            block.type === "image" &&
            block.data
          ) {
            outputImage =
              block.data;
            break;
          }

        }

        if (outputImage) break;
      }
    }

    if (!outputImage) {
      throw new Error(
        "Gemini returned no image."
      );
    }

    return res.status(200).json({
      ok: true,
      image: outputImage,
      mimeType: "image/jpeg"
    });

  } catch (error) {

    console.error(
      "SCHOOLBUDS IMAGE ERROR:",
      error
    );

    return errorResponse(
      res,
      500,
      error?.message ||
        "Image generation failed."
    );
  }
}
