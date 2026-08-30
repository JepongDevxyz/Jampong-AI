const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const MODEL = "gemini-3.7-flash";

function getKeys() {
  const raw =
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    "";

  return raw
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);
}

/*
 * Round-robin API key rotation.
 * Each warm Vercel instance advances to the next key.
 */
let keyIndex = 0;

function nextKey() {
  const keys = getKeys();

  if (!keys.length) {
    throw new Error(
      "GEMINI_API_KEYS is not configured in Vercel Environment Variables."
    );
  }

  const key = keys[keyIndex % keys.length];

  keyIndex =
    (keyIndex + 1) % keys.length;

  return key;
}

function systemInstruction(options = {}) {
  const {
    studyMode = false,
    academicMaster = false,
    strictSubject = false,
    codingAssistant = false
  } = options;

  let text = `
You are Jampong AI, a student-focused academic AI tutor.

Your creator/developer is Jay-Ar Lee Espiritu.

If the user asks:
"Who made you?"
"Who created you?"
"Who developed you?"
"Who is your developer?"
or equivalent questions, answer:

"Jampong AI was developed by Jay-Ar Lee Espiritu."

You are an advanced academic tutor.

You can help with:
- Mathematics
- Science
- English
- Filipino
- History
- Social Studies
- Literature
- Research
- Programming
- Computer Science
- Writing
- General academic subjects

Your goal is to help students understand.

For homework and academic problems:
1. Understand the question.
2. Explain the concept.
3. Show the reasoning or steps when appropriate.
4. Give the final answer clearly.
5. Provide an example when useful.

Use Markdown.

Use fenced code blocks for programming.

Do not pretend to have real-world credentials.
Do not claim to actually hold a degree or academic honor.

Be concise when the question is simple and detailed when the
student needs an explanation.

Never expose API keys or server configuration.
`;

  if (academicMaster) {
    text += `

ACADEMIC MASTER MODE:
Act as an exceptionally capable academic tutor across subjects.
Give rigorous, structured explanations.
`;
  }

  if (studyMode) {
    text += `

STUDY MODE:
Teach rather than simply answer.
Break difficult topics into manageable parts.
Use examples, summaries and short practice questions.
`;
  }

  if (strictSubject) {
    text += `

STRICT TUTORING SUBJECT MODE:
Stay focused on the student's selected subject.
Avoid unrelated discussion unless necessary.
`;
  }

  if (codingAssistant) {
    text += `

CODING ASSISTANT MODE:
Help students write, debug and understand code.
Explain errors and provide complete examples when appropriate.
Prefer secure and maintainable solutions.
`;
  }

  return text;
}

function buildInput({
  message,
  attachments = []
}) {
  const content = [
    {
      type: "text",
      text: message
    }
  ];

  for (const file of attachments.slice(0, 5)) {
    if (
      !file ||
      !file.data ||
      !file.mimeType
    ) {
      continue;
    }

    const mime =
      String(file.mimeType);

    if (
      mime === "application/pdf" ||
      mime.startsWith("text/") ||
      mime === "application/json"
    ) {
      content.push({
        type: "document",
        data: file.data,
        mime_type: mime
      });
    } else if (
      mime.startsWith("image/")
    ) {
      content.push({
        type: "image",
        data: file.data,
        mime_type: mime
      });
    }
  }

  /*
   * If there are no attachments, sending a string
   * keeps the request simple.
   */
  if (content.length === 1) {
    return message;
  }

  return content;
}

function jsonError(message, status = 500) {
  return Response.json(
    {
      ok: false,
      error: message
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonError(
      "POST method required.",
      405
    );
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return jsonError(
      "Invalid JSON request.",
      400
    );
  }

  const {
    message,
    previousInteractionId = null,
    attachments = [],
    webSearch = false,
    studyMode = false,
    academicMaster = false,
    strictSubject = false,
    codingAssistant = false,
    thinkingLevel = "medium"
  } = body || {};

  if (
    typeof message !== "string" ||
    !message.trim()
  ) {
    return jsonError(
      "Message is required.",
      400
    );
  }

  const allowedThinking = [
    "low",
    "medium",
    "high"
  ];

  const thinking =
    allowedThinking.includes(
      thinkingLevel
    )
      ? thinkingLevel
      : "medium";

  let key;

  try {
    key = nextKey();
  } catch (error) {
    return jsonError(
      error.message,
      500
    );
  }

  const payload = {
    model: MODEL,
    input: buildInput({
      message: message.trim(),
      attachments
    }),
    stream: true,
    store: true,
    system_instruction:
      systemInstruction({
        studyMode,
        academicMaster,
        strictSubject,
        codingAssistant
      }),
    generation_config: {
      thinking_level: thinking
    }
  };

  if (previousInteractionId) {
    payload.previous_interaction_id =
      previousInteractionId;
  }

  if (webSearch) {
    payload.tools = [
      {
        type: "google_search"
      }
    ];
  }

  let upstream;

  try {
    upstream = await fetch(
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
    return jsonError(
      "Unable to connect to Gemini: " +
        error.message,
      502
    );
  }

  if (!upstream.ok) {
    const errorText =
      await upstream.text();

    return new Response(
      errorText || "Gemini request failed.",
      {
        status: upstream.status,
        headers: {
          "Content-Type":
            "application/json",
          "Cache-Control":
            "no-store"
        }
      }
    );
  }

  /*
   * Pass Gemini's SSE stream directly to browser.
   * This preserves:
   * interaction.created
   * step.delta
   * interaction.completed
   * and other current events.
   */
  return new Response(
    upstream.body,
    {
      status: 200,
      headers: {
        "Content-Type":
          "text/event-stream; charset=utf-8",
        "Cache-Control":
          "no-cache, no-transform",
        "Connection":
          "keep-alive",
        "X-Accel-Buffering":
          "no"
      }
    }
  );
}
