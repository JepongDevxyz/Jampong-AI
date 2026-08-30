module.exports = async function (req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  let s = "";

  req.on("data", c => {
    s += c;
  });

  req.on("end", () => {
    try {
      const body = JSON.parse(s || "{}");

      if (
        !["up", "down"].includes(
          body.value
        )
      ) {
        return res.status(400).json({
          error: "Invalid feedback"
        });
      }

      console.log(
        JSON.stringify({
          event: "feedback",
          ...body,
          time:
            new Date().toISOString()
        })
      );

      return res.status(200).json({
        ok: true
      });
    }

    catch {
      return res.status(400).json({
        error: "Invalid JSON"
      });
    }
  });
};
