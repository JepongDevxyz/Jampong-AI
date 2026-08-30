# Jampong AI v4
Set Vercel Environment Variable:
GEMINI_API_KEYS=key1,key2,key3,key4

No npm install is required; the API routes use Gemini REST directly.

Important: Gemini 3.7 Flash is the main tutor/analysis model. It does NOT support image generation, so the Dola Image Studio uses the supported Gemini 3.1 Flash Image model for actual generation/editing. This is why the image route must not send an image/png response_format MIME type to Gemini 3.7 Flash.

The UI contains all 34 requested services with working browser/server handlers.