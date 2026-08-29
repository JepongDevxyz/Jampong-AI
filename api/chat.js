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
    const { prompt, model, history, image, webSearch, studyMode, strictTutoring, systemMode, mode } = req.body;

    // ==========================================
    // 1. IMAGE GENERATION ENGINE (CLICKABLE & 4K/1080P DOWNLOAD)
    // ==========================================
    if (mode === 'generate') {
      const finalPrompt = prompt || 'A creative artwork';
      const encodedPrompt = encodeURIComponent(finalPrompt);
      const seed = Math.floor(Math.random() * 999999);

      // Stable direct endpoints
      const img1080 = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux&seed=${seed}&width=1920&height=1080&nologo=true`;
      const img4K = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux-realism&seed=${seed}&width=3840&height=2160&nologo=true`;

      // Formatted card with clickable image & download options
      const formattedResponse = `
        <div class="flex flex-col gap-3 my-1">
          <p class="text-emerald-400 font-medium">Narito ang iyong na-generate na larawan batay sa prompt: "${finalPrompt}"</p>
          <div class="relative group rounded-xl overflow-hidden border border-white/20 bg-black/40">
            <a href="${img4K}" target="_blank" rel="noopener noreferrer" class="block cursor-pointer">
              <img src="${img1080}" alt="${finalPrompt}" class="w-full h-auto object-cover hover:scale-[1.02] transition duration-300" />
            </a>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
            <a href="${img4K}" target="_blank" rel="noopener noreferrer" class="text-xs text-indigo-400 hover:underline flex items-center gap-1 font-medium">
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i> Tignan sa Full Resolution
            </a>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-gray-400">Download:</span>
              <button onclick="downloadImageBlob('${img1080}', '1080p')" class="px-2.5 py-1 text-xs font-semibold bg-slate-800 hover:bg-indigo-600 rounded-md border border-slate-700 transition">1080p</button>
              <button onclick="downloadImageBlob('${img4K}', '4k')" class="px-2.5 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 rounded-md transition">4K</button>
            </div>
          </div>
        </div>
      `;

      return res.status(200).json({ response: formattedResponse, imageUrl: img4K });
    }

    // ==========================================
    // 2. TEXT & VISION AI TUTOR ENGINE (GEMINI)
    // ==========================================
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

    const preferredModel = model && [
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview'
    ].includes(model) ? model : 'gemini-3.7-flash';

    const fallbackModels = [
      preferredModel,
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite'
    ];

    let data = null;
    let lastError = null;

    for (const currentModel of fallbackModels) {
      const payload = { contents };
      if (webSearch) {
        payload.tools = [{ google_search: {} }];
      }

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      data = await response.json();

      if (!data.error) {
        lastError = null;
        break;
      } else {
        lastError = data.error.message;
        console.warn(`Model ${currentModel} failed with error: ${lastError}. Trying next fallback...`);
      }
    }

    if (lastError) {
      throw new Error(`Lahat ng models ay nag-error: ${lastError}`);
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Walang natanggap na sagot mula sa model.';
    return res.status(200).json({ response: reply });

  } catch (err) {
    console.error('Server Handler Error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
