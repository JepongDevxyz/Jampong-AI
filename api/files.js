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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "POST only."
    });
  }

  try {
    const {
      prompt = "Analyze this file and explain the important information clearly.",
      files = []
    } = req.body || {};

    if (!files.length) {
      return res.status(400).json({
        ok: false,
        error: "No files supplied."
      });
    }

    const parts = [
      {
        text: prompt.slice(0, 10000)
      }
    ];

    for (const file of files.slice(0, 5)) {
      if (!file.data || !file.mimeType) continue;

      if (file.data.length > 15_000_000) {
        continue;
      }

      parts.push({
        inline_data: {
          mime_type: file.mimeType,
          data: file.data
        }
      });
    }

    const ai = new GoogleGenAI({
      apiKey: pickKey()
    });

    const result = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: [
        {
          role: "user",
          parts
        }
      ],
      config: {
        systemInstruction: `
You are SchoolBuds File Analysis.

Analyze supplied educational files accurately.
Explain important sections, summarize when requested,
extract useful information, and help the student understand it.

Do not invent information that is not present in the file.
`
      }
    });

    return res.status(200).json({
      ok: true,
      text: result.text || ""
    });

  } catch (error) {
    console.error("FILE ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || "File analysis failed."
    });
  }
}
