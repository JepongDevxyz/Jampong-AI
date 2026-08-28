let currentKeyIndex = 0;

function getNextApiKey() {
  const keysEnv = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  const keys = keysEnv.split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  const apiKey = keys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  return apiKey;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, model, history, image, webSearch, studyMode, strictTutoring, systemMode } = req.body;
    
    const apiKey = getNextApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: 'API Keys missing on Vercel Environment Variables.' });
    }

    let systemInstruction = `Ikaw si Jampong AI, isang mahusay at matalinong academic tutor na dalubhasa sa lahat ng asignatura.`;

    if (strictTutoring) {
      systemInstruction += `\n[STRICT TUTORING ACTIVE]: Huwag ibigay ang direktang sagot. Gabayan ang estudyante gamit ang mga pahiwatig (Socratic Method).`;
    }
    if (studyMode) {
      systemInstruction += `\n[STUDY MODE ACTIVE]: Ibigay ang sagot sa anyo ng structured summary, bulleted points, at maikling 3-question quiz sa huli.`;
    }
    if (systemMode === 'calculator') {
      systemInstruction += `\n[CALCULATOR MODE]: Magpakita ng detalyadong mathematical resolution breakdown.`;
    } else if (systemMode === 'coding') {
      systemInstruction += `\n[CODING ASSISTANT]: Magbigay ng malinis at functional code snippets na may inline comments.`;
    }

    const contents = [];

    if (Array.isArray(history)) {
      history.forEach(item => {
        contents.push({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: item.text }]
        });
      });
    }

    const userParts = [{ text: `${systemInstruction}\n\nUser Input: ${prompt || 'Analyze this image.'}` }];

    if (image) {
      const base64Data = image.includes(',') ? image.split(',')[1] : image;
      const mimeType = image.includes(';') ? image.split(';')[0].split(':')[1] : 'image/jpeg';
      userParts.push({
        inline_data: { mime_type: mimeType, data: base64Data }
      });
    }

    contents.push({ role: 'user', parts: userParts });

    // Siguraduhing ligtas at gumagana ang model name
    const selectedModel = (model && model.includes('flash')) ? model : 'gemini-1.5-flash';
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
    
    if (data.error) {
      console.error('Gemini API Error Details:', JSON.stringify(data.error));
      throw new Error(data.error.message || 'Gemini API Error');
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Walang natanggap na sagot mula sa model.';
    return res.status(200).json({ response: reply });

  } catch (err) {
    console.error('Server Handler Error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
