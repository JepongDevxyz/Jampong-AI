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

  try {
    const body =
      await req.json();

    const {
      rating,
      message,
      conversationId
    } = body || {};

    if (
      !rating ||
      !["up", "down"].includes(rating)
    ) {
      return Response.json(
        {
          ok: false,
          error:
            "Rating must be up or down."
        },
        { status: 400 }
      );
    }

    /*
     * No external database is required.
     * This confirms the feedback request
     * was accepted by the backend.
     *
     * You can later connect this to
     * Vercel Postgres/Supabase/etc.
     */

    console.log(
      JSON.stringify({
        type: "student_ai_feedback",
        rating,
        message:
          String(message || "").slice(
            0,
            1000
          ),
        conversationId:
          conversationId || null,
        timestamp:
          new Date().toISOString()
      })
    );

    return Response.json({
      ok: true,
      message:
        "Feedback received."
    });

  } catch {
    return Response.json(
      {
        ok: false,
        error: "Invalid JSON."
      },
      { status: 400 }
    );
  }
}
