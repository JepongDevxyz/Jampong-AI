let currentKeyIndex = 0;

function getNextApiKey() {
  const keysEnv = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  const keys = keysEnv.split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  const apiKey = keys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  return apiKey;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, model, history, image, webSearch, studyMode, strictTutoring, mode } = req.body;
    const apiKey = getNextApiKey();

    if (!apiKey) {
      return res.status(500).json({ error: 'API Keys missing on Vercel Environment Variables.' });
    }

    // IMAGE GENERATION MODE
    if (mode === 'generate') {
      let finalPrompt = prompt || 'A detailed artwork';

      if (image) {
        try {
          const base64Data = image.includes(',') ? image.split(',')[1] : image;
          const mimeType = image.includes(';') ? image.split(';')[0].split(':')[1] : 'image/jpeg';

          const visionSystemInstruction = `
            You are an expert AI Image-to-Image Prompt Engineer.
            Analyze the image and apply edit instruction: "${prompt}".
            Return ONLY the final detailed prompt in English.
          `;

          const visionPayload = {
            contents: [{
              role: 'user',
              parts: [
                { text: visionSystemInstruction },
                { inline_data: { mime_type: mimeType, data: base64Data } }
              ]
            }]
          };

          const visionModels = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];
          const visionPromises = visionModels.map(async (vModel) => {
            const vRes = await fetchWithTimeout(
              `https://generativelanguage.googleapis.com/v1beta/models/${vModel}:generateContent?key=${apiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(visionPayload)
              },
              8000
            );
            const vData = await vRes.json();
            const textResult = vData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textResult) return textResult.trim();
            throw new Error(`Empty response from ${vModel}`);
          });

          const enrichedPrompt = await Promise.any(visionPromises).catch(() => null);
          if (enrichedPrompt) finalPrompt = enrichedPrompt;
        } catch (e) {
          console.warn('Vision enrichment failed:', e.message);
        }
      }

      const encodedPrompt = encodeURIComponent(finalPrompt);
      const seed = Math.floor(Math.random() * 999999);
      const img1080 = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux&seed=${seed}&width=1920&height=1080&nologo=true`;
      const img4K = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux-realism&seed=${seed}&width=3840&height=2160&nologo=true`;

      const formattedResponse = `
        <div class="flex flex-col gap-3 my-1">
          <p class="text-emerald-400 font-medium">Narito ang iyong na-generate na larawan:</p>
          <div class="relative group rounded-xl overflow-hidden border border-white/20 bg-black/40">
            <a href="${img4K}" target="_blank" rel="noopener noreferrer">
              <img src="${img1080}" alt="${finalPrompt}" class="w-full h-auto object-cover" />
            </a>
          </div>
        </div>
      `;

      return res.status(200).json({ response: formattedResponse, imageUrl: img4K });
    }

    // ==========================================
    // 2. ULTRA-FAST SSE STREAMING CHAT ENGINE
    // ==========================================
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    let systemInstruction = `Ikaw si Jampong AI, isang mahusay, matalino, at maaasahang assistant at academic tutor.`;
    if (strictTutoring) systemInstruction += `\n[STRICT TUTORING ACTIVE]: Huwag ibigay ang direktang sagot. Gabayan ang estudyante gamit ang Socratic Method.`;
    if (studyMode) systemInstruction += `\n[STUDY MODE ACTIVE]: Ibigay ang sagot sa anyo ng structured summary, bulleted points, at maikling 3-question quiz sa huli.`;

    const contents = [];
    if (Array.isArray(history)) {
      history.forEach(item => {
        contents.push({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: item.text }]
        });
      });
    }

    const userParts = [{ text: `${systemInstruction}\n\nUser Input: ${prompt || 'Analyze this input.'}` }];
    if (image) {
      const base64Data = image.includes(',') ? image.split(',')[1] : image;
      const mimeType = image.includes(';') ? image.split(';')[0].split(':')[1] : 'image/jpeg';
      userParts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
    }
    contents.push({ role: 'user', parts: userParts });

    // Piliin ang model at fallback
    const selectedModel = model || 'gemini-2.5-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

    // Clean payload para iwas crash sa 3.x models
    const payload = { contents };
    if (webSearch) {
      payload.tools = [{ google_search: {} }];
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      let errorMessage = 'Failed to fetch from Gemini API';
      try {
        const parsedErr = JSON.parse(errText);
        errorMessage = parsedErr.error?.message || errorMessage;
      } catch (e) {
        errorMessage = errText || errorMessage;
      }
      
      res.write(`data: ${JSON.stringify({ error: `Gemini API Error (${response.status}): ${errorMessage}` })}\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }

    res.end();

  } catch (err) {
    console.error('Streaming Error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}
