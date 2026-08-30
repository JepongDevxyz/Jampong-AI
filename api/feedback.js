export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "POST only."
    });
  }

  try {
    const {
      type,
      messageId,
      comment = ""
    } = req.body || {};

    if (!["positive", "negative"].includes(type)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid feedback type."
      });
    }

    /*
      Vercel serverless functions are stateless.
      This endpoint validates and logs feedback.

      For permanent storage, connect this handler to
      a database such as Vercel Postgres/Blob or another
      database provider.
    */

    console.log("SCHOOLBUDS_FEEDBACK", {
      type,
      messageId,
      comment: String(comment).slice(0, 2000),
      createdAt: new Date().toISOString()
    });

    return res.status(200).json({
      ok: true
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: "Feedback failed."
    });
  }
}
