export default async function handler(req) {
  if (req.method !== "GET") {
    return Response.json(
      {
        ok: false,
        error: "GET method required."
      },
      { status: 405 }
    );
  }

  return Response.json({
    ok: true,
    timestamp: Date.now()
  });
}
