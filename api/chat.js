export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, model, history, image, webSearch, studyMode, strictTutoring, systemMode } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API Key missing on Vercel Environment Variables.' });
    }

    // Default System Instruction & Identity
    let systemInstruction = `Ikaw si Academic Jampong AI, isang Bachelor Magna Cum Laude level academic tutor na dalubhasa sa lahat ng asignatura.
DEVELOPER & CREATOR: Ikaw ay nilikha at binuo ng developer na si Jay-Ar Lee Espiritu. Kapag tinanong ka kung sino ang gumawa o nag-develop sa iyo, DAPAT mong sabihin na ikaw ay binuo ni Jay-Ar Lee Espiritu.`;

    if (strictTutoring) {
      systemInstruction += `\n[STRICT TUTORING ACTIVE]: Huwag ibigay ang direktang sagot sa mga takdang-aralin o problema. Gabayan ang estudyante gamit ang mga pahiwatig (Socratic Method) at step-by-step questions.`;
    }
    if (studyMode) {
      systemInstruction += `\n[STUDY MODE ACTIVE]: Ibigay ang sagot sa anyo ng structured summary, bulleted points, flashcard-style concepts, at maikling 3-question quiz sa huli.`;
    }
    if (systemMode === 'calculator') {
      systemInstruction += `\n[CALCULATOR MODE]: Magpakita ng detalyadong mathematical resolution breakdown na may mga pormula at tiyak na huling halaga.`;
    } else if (systemMode === 'coding') {
      systemInstruction += `\n[CODING ASSISTANT]: Magbigay ng malinis, modular, at functional code snippets na may inline comments at paliwanag sa logic.`;
    }

    const contents = [];

    // Parse History
    if (Array.isArray(history)) {
      history.forEach(item => {
        contents.push({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: item.text }]
        });
      });
    }

    // Attach Current User Payload
    const userParts = [{ text: `${systemInstruction}\n\nUser Input: ${prompt}` }];

    if (image) {
      const base64Data = image.includes(',') ? image.split(',')[1] : image;
      const mimeType = image.includes(';') ? image.split(';')[0].split(':')[1] : 'image/jpeg';
      userParts.push({
        inline_data: { mime_type: mimeType, data: base64Data }
      });
    }

    contents.push({ role: 'user', parts: userParts });

    const selectedModel = model || 'gemini-1.5-flash';
    const payload = { contents };

    if (webSearch) {
      payload.tools = [{ google_search: {} }];
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Walang natanggap na sagot mula sa model.';
    return res.status(200).json({ response: reply });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
