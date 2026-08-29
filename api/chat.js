let currentKeyIndex = 0;

function getNextApiKey() {
  const keysEnv = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  const keys = keysEnv.split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  const apiKey = keys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  return apiKey;
}

// Helper function para sa fetch na may strict timeout (hal. 12 seconds)
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
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

    // ==========================================
    // 1. IMAGE GENERATION & EDITING ENGINE
    // ==========================================
    if (mode === 'generate') {
      let finalPrompt = prompt || 'A detailed artwork';

      if (image) {
        try {
          const base64Data = image.includes(',') ? image.split(',')[1] : image;
          const mimeType = image.includes(';') ? image.split(';')[0].split(':')[1] : 'image/jpeg';

          const visionSystemInstruction = `
            You are an expert AI Image-to-Image Prompt Engineer.
            The user has uploaded an existing image and provided this edit instruction: "${prompt}".
            Strictly analyze the uploaded image and generate a descriptive text-to-image prompt by following these rules:
            1. Keep the exact same graphic style, UI layout, composition, framing, color scheme, typography placement, and background elements from the original image.
            2. Apply ONLY the modification requested by the user: "${prompt}".
            Return ONLY the final detailed image generation prompt in English with no conversational filler.
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

          // Fast parallel model trial (Parallel calls para makuha agad ang unang mabilis na sagot)
          const visionModels = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];
          
          const visionPromises = visionModels.map(async (vModel) => {
            const vRes = await fetchWithTimeout(
              `https://generativelanguage.googleapis.com/v1beta/models/${vModel}:generateContent?key=${apiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(visionPayload)
              },
              8000 // 8-second timeout per vision call
            );
            const vData = await vRes.json();
            const textResult = vData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textResult) return textResult.trim();
            throw new Error(`Empty response from ${vModel}`);
          });

          // Kunin ang pinakamabilis na nag-return na valid result
          const enrichedPrompt = await Promise.any(visionPromises).catch(() => null);

          if (enrichedPrompt) {
            finalPrompt = enrichedPrompt;
          }
        } catch (e) {
          console.warn('Vision prompt enrichment failed, fallback to raw text prompt:', e.message);
        }
      }

      const encodedPrompt = encodeURIComponent(finalPrompt);
      const seed = Math.floor(Math.random() * 999999);

      const img1080 = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux&seed=${seed}&width=1920&height=1080&nologo=true`;
      const img4K = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux-realism&seed=${seed}&width=3840&height=2160&nologo=true`;

      const formattedResponse = `
        <div class="flex flex-col gap-3 my-1">
          <p class="text-emerald-400 font-medium">Narito ang iyong na-generate / na-edit na larawan batay sa kahilingan: "${prompt || 'Artwork'}"</p>
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
    // 2. TEXT & VISION CHAT ENGINE
    // ==========================================
    let systemInstruction = `Ikaw si Jampong AI, isang mahusay, matalino, at maaasahang assistant at academic tutor.`;

    if (strictTutoring) {
      systemInstruction += `\n[STRICT TUTORING ACTIVE]: Huwag ibigay ang direktang sagot. Gabayan ang estudyante gamit ang Socratic Method.`;
    }
    if (studyMode) {
      systemInstruction += `\n[STUDY MODE ACTIVE]: Ibigay ang sagot sa anyo ng structured summary, bulleted points, at maikling 3-question quiz sa huli.`;
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

    const userParts = [{ text: `${systemInstruction}\n\nUser Input: ${prompt || 'Analyze this input.'}` }];

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
    
    // Inalis ang mga duplicate sa fallback models gamit ang Set
    const fallbackModels = Array.from(new Set([
      preferredModel,
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite'
    ]));

    let data = null;
    let lastError = null;

    for (const currentModel of fallbackModels) {
      const payload = { 
        contents,
        // Pinapabilis ang tugon sa pamamagitan ng pag-disable sa deep reasoning overhead
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      };

      if (webSearch) {
        payload.tools = [{ google_search: {} }];
      }

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      
      try {
        const response = await fetchWithTimeout(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }, 12000); // Max 12s bawat model try

        data = await response.json();

        if (!data.error) {
          lastError = null;
          break;
        } else {
          lastError = data.error.message;
        }
      } catch (err) {
        lastError = err.message || 'Fetch timeout / network error';
        console.warn(`Model ${currentModel} timed out or failed. Trying next...`);
      }
    }

    if (lastError) {
      throw new Error(`Error mula sa model: ${lastError}`);
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Walang natanggap na sagot mula sa model.';
    return res.status(200).json({ response: reply });

  } catch (err) {
    console.error('Server Handler Error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
