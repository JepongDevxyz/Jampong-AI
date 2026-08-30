import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL =
  "gemini-3.7-flash";

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

function getSystemInstruction(options) {

  const {
    studyMode,
    academicMaster,
    strictSubject,
    codingAssistant
  } = options;

  let text = `
You are SchoolBuds AI, a student-focused
academic AI tutor.

If the user asks who created, developed,
programmed, or made you, answer exactly:

"SchoolBuds AI was developed by Jay-Ar Lee Espiritu."

You are highly knowledgeable across normal
academic subjects including:

Mathematics
Science
English
Filipino
History
Social Studies
Programming
Computer Science
Research
Writing
and other academic subjects.

Your job is to help students understand
concepts instead of simply dumping answers.

For academic problems:

1. Understand the question.
2. Explain the concept.
3. Give clear steps.
4. Provide the answer.
5. Give an example when useful.

Use Markdown when useful.

Use fenced code blocks for programming.

Never claim to be a human teacher.

Be accurate and do not fabricate sources.
`;

  if (studyMode) {

    text += `

STUDY MODE:

Teach interactively.

Break difficult lessons into smaller
sections.

Use examples and short practice questions
when useful.

Prioritize learning and understanding.
`;
  }

  if (academicMaster) {

    text += `

ACADEMIC MASTER:

Act as an exceptionally strong academic
tutor with broad subject knowledge.

Be rigorous, precise and organized.

Do not falsely claim an actual degree,
academic honor, or real-world credential.
`;
  }

  if (strictSubject) {

    text += `

STRICT TUTORING:

Stay focused on the academic subject
requested by the student.

Avoid unnecessary unrelated discussion.
`;
  }

  if (codingAssistant) {

    text += `

CODING ASSISTANT:

Act as a strong programming tutor.

Explain bugs clearly.

Provide complete working examples
when appropriate.

Consider security and reliability.
`;
  }

  return text;
}

function buildInput(messages, files) {

  const input = [];

  /*
    Interactions API expects user/model history
    in structured interaction steps when sending
    stateless conversation history.
  */

  for (
    const message of messages.slice(-30)
  ) {

    if (
      message.role === "user"
    ) {

      input.push({
        type: "user_input",
        content: [
          {
            type: "text",
            text:
              String(
                message.content || ""
              )
          }
        ]
      });

    } else if (
      message.role === "assistant"
    ) {

      input.push({
        type: "model_output",
        content: [
          {
            type: "text",
            text:
              String(
                message.content || ""
              )
          }
        ]
      });

    }

  }

  /*
    Attach files to the latest user turn.
  */

  if (files?.length) {

    const lastUser =
      [...input]
        .reverse()
        .find(
          x => x.type === "user_input"
        );

    if (lastUser) {

      for (
        const file of files.slice(0, 5)
      ) {

        if (
          !file.data ||
          !file.mimeType
        ) {
          continue;
        }

        /*
          Gemini Interactions uses document
          blocks for PDFs and image blocks for
          images.
        */

        if (
          file.mimeType ===
          "application/pdf"
        ) {

          lastUser.content.push({
            type: "document",
            data: file.data,
            mime_type: file.mimeType
          });

        } else if (
          file.mimeType.startsWith(
            "image/"
          )
        ) {

          lastUser.content.push({
            type: "image",
            data: file.data,
            mime_type: file.mimeType
          });

        } else {

          /*
            For text-like files, decode them
            server-side is not necessary if
            the browser already has the content.
            The frontend currently sends base64,
            so treat it as a document only for
            supported document types.
          */

          lastUser.content.push({
            type: "document",
            data: file.data,
            mime_type: file.mimeType
          });

        }

      }

    }

  }

  return input;
}

export default async function handler(
  req,
  res
) {

  if (req.method !== "POST") {

    return res.status(405).json({
      ok: false,
      error:
        "POST method required."
    });
  }

  try {

    const {
      messages = [],
      files = [],
      model = DEFAULT_MODEL,
      webSearch = false,
      studyMode = false,
      academicMaster = false,
      strictSubject = false,
      codingAssistant = false,
      thinkingLevel = "medium"
    } = req.body || {};

    if (
      !Array.isArray(messages) ||
      !messages.length
    ) {

      return res.status(400).json({
        ok: false,
        error:
          "No conversation messages."
      });
    }

    const allowedModels = [
      "gemini-3.7-flash"
    ];

    /*
      Keep the release version locked to
      the requested Gemini 3.7 Flash.
    */

    const selectedModel =
      allowedModels.includes(model)
        ? model
        : DEFAULT_MODEL;

    const allowedThinking = [
      "low",
      "medium",
      "high"
    ];

    const selectedThinking =
      allowedThinking.includes(
        thinkingLevel
      )
        ? thinkingLevel
        : "medium";

    const ai = new GoogleGenAI({
      apiKey: getRandomKey()
    });

    const input =
      buildInput(
        messages,
        files
      );

    const config = {

      model:
        selectedModel,

      input,

      system_instruction:
        getSystemInstruction({
          studyMode,
          academicMaster,
          strictSubject,
          codingAssistant
        }),

      generation_config: {
        thinking_level:
          selectedThinking
      },

      stream: true,

      store: false
    };

    if (webSearch) {

      config.tools = [
        {
          type:
            "google_search"
        }
      ];
    }

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "text/event-stream; charset=utf-8"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-transform"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );

    res.setHeader(
      "X-Accel-Buffering",
      "no"
    );

    const stream =
      await ai.interactions.create(
        config
      );

    let sentText = false;

    for await (
      const event of stream
    ) {

      if (
        res.writableEnded
      ) {
        break;
      }

      /*
        Current Interactions streaming emits
        step.delta events.
      */

      if (
        event.event_type ===
        "step.delta"
      ) {

        const delta =
          event.delta;

        if (
          delta?.type === "text" &&
          delta.text
        ) {

          sentText = true;

          res.write(
            `data: ${JSON.stringify({
              type: "text",
              text: delta.text
            })}\n\n`
          );

        }

      }

    }

    /*
      Some SDK/API versions may provide the
      complete output through another event.
      The frontend only needs the text deltas
      for streaming.
    */

    res.write(
      `data: ${JSON.stringify({
        type: "done",
        streamed: sentText
      })}\n\n`
    );

    res.end();

  } catch (error) {

    console.error(
      "SCHOOLBUDS CHAT ERROR:",
      error
    );

    if (
      res.headersSent
    ) {

      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error:
            error?.message ||
            "Gemini request failed."
        })}\n\n`
      );

      res.end();

      return;
    }

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Gemini request failed."
    });
  }
}
