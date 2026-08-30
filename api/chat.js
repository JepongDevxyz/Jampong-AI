import { GoogleGenAI } from "@google/genai";

const MODEL_DEFAULT = "gemini-3.7-flash";

function getKeys() {
  const raw = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";

  return raw
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);
}

function pickKey() {
  const keys = getKeys();

  if (!keys.length) {
    throw new Error("No Gemini API key configured.");
  }

  const index = Math.floor(Math.random() * keys.length);
  return keys[index];
}

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(m => m && typeof m.content === "string")
    .slice(-40)
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content.slice(0, 30000) }]
    }));
}

function buildInstruction(options = {}) {
  const {
    studyMode = false,
    academicMaster = false,
    strictSubject = false,
    codingAssistant = false
  } = options;

  let instruction = `
You are SchoolBuds AI, an educational assistant designed to help students.

IMPORTANT IDENTITY:
If the user asks who created, developed, programmed, or made you, answer:
"SchoolBuds AI was developed by Jay-Ar Lee Espiritu."

You are an expert educational tutor across mathematics, science, English,
Filipino, programming, computer science, history, social studies, research,
writing, and other normal academic subjects.

Your purpose is to TEACH, not merely dump answers.

When explaining academic problems:
1. Understand the question.
2. Explain the concept.
3. Show the solution or reasoning in clear steps.
4. Give the final answer.
5. When useful, provide a short practice question.

Never claim to be a human teacher.

Use Markdown when useful.
Use fenced code blocks for programming code.

For homework questions, encourage understanding and show the method.
Do not fabricate sources.
If information may be current, recommend or use web search when enabled.

Keep answers age-appropriate, respectful and educational.
`;

  if (studyMode) {
    instruction += `
STUDY MODE:
Teach interactively.
Break difficult lessons into small sections.
Ask a short comprehension question when appropriate.
Prefer explanations, examples and practice over simply giving an answer.
`;
  }

  if (academicMaster) {
    instruction += `
ACADEMIC MASTER MODE:
Act as an exceptionally strong academic tutor with graduate-level breadth
while explaining concepts in a way a student can understand.
Be rigorous, precise and organized.
Do not claim an actual degree or academic honor.
`;
  }

  if (strictSubject) {
    instruction += `
STRICT TUTORING SUBJECT MODE:
Stay focused on the academic subject requested by the user.
If the user changes subjects, acknowledge the change and refocus.
Avoid unnecessary unrelated discussion.
`;
  }

  if (codingAssistant) {
    instruction += `
CODING ASSISTANT MODE:
Act as a senior programming tutor.
Explain bugs, architecture and code clearly.
Prefer complete working examples.
When modifying code, preserve important existing functionality.
Mention important security considerations.
`;
  }

  return instruction;
}

function makeContents(messages, files) {
  const contents = cleanMessages(messages);

  if (files?.length) {
    const last = contents[contents.length - 1];

    if (last?.role === "user") {
      for (const file of files.slice(0, 4)) {
        if (
          file?.mimeType &&
          file?.data &&
          file.data.length < 15_000_000
        ) {
          last.parts.push({
            inline_data: {
              mime_type: file.mimeType,
              data: file.data
            }
          });
        }
      }
    }
  }

  return contents;
}

function sendError(res, status, message) {
  res.status(status).json({
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
      messages = [],
      files = [],
      model = MODEL_DEFAULT,
      webSearch = false,
      studyMode = false,
      academicMaster = false,
      strictSubject = false,
      codingAssistant = false,
      thinkingLevel = "medium"
    } = req.body || {};

    const allowedModels = [
      "gemini-3.7-flash",
      "gemini-3.6-flash"
    ];

    const selectedModel = allowedModels.includes(model)
      ? model
      : MODEL_DEFAULT;

    const allowedThinking = ["low", "medium", "high"];

    const selectedThinking = allowedThinking.includes(thinkingLevel)
      ? thinkingLevel
      : "medium";

    const key = pickKey();

    const ai = new GoogleGenAI({
      apiKey: key
    });

    const contents = makeContents(messages, files);

    if (!contents.length) {
      return sendError(res, 400, "No conversation content supplied.");
    }

    const config = {
      systemInstruction: buildInstruction({
        studyMode,
        academicMaster,
        strictSubject,
        codingAssistant
      }),
      thinkingConfig: {
        thinkingLevel: selectedThinking
      }
    };

    if (webSearch) {
      config.tools = [
        {
          googleSearch: {}
        }
      ];
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = await ai.models.generateContentStream({
      model: selectedModel,
      contents,
      config
    });

    for await (const chunk of stream) {
      if (res.writableEnded) break;

      const text = chunk.text || "";

      if (text) {
        res.write(
          `data: ${JSON.stringify({
            type: "text",
            text
          })}\n\n`
        );
      }
    }

    res.write(
      `data: ${JSON.stringify({
        type: "done"
      })}\n\n`
    );

    res.end();

  } catch (error) {
    console.error("CHAT ERROR:", error);

    if (!res.headersSent) {
      return sendError(
        res,
        500,
        error?.message || "Gemini request failed."
      );
    }

    res.write(
      `data: ${JSON.stringify({
        type: "error",
        error: error?.message || "Generation failed."
      })}\n\n`
    );

    res.end();
  }
}
