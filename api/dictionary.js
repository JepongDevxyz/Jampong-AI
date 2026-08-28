export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const word = req.query.word || req.body?.word;
  if (!word) {
    return res.status(400).json({ error: 'Walang salitang ibinigay.' });
  }

  const apiKey = process.env.MERRIAM_WEBSTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Merriam-Webster API key missing in Vercel.' });
  }

  const apiUrl = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${apiKey}`;

  try {
    const apiResponse = await fetch(apiUrl);
    const textData = await apiResponse.text();

    let jsonData;
    try {
      jsonData = JSON.parse(textData);
    } catch (e) {
      console.error("Non-JSON response from Merriam-Webster:", textData);
      return res.status(500).json({ error: `Merriam-Webster Error: ${textData}` });
    }

    return res.status(200).json(jsonData);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
