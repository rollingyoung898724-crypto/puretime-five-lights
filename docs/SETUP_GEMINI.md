# Gemini setup

Return System uses `@google/genai` 2.15.0 and the current Gemini Interactions API. The configured default is the stable multimodal model `gemini-3.6-flash`.

1. Open Google AI Studio and create or select a development project.
2. Create a Gemini API key for that project.
3. Add the key to the Vercel server environment as `GEMINI_API_KEY`.
4. Set `GEMINI_MODEL=gemini-3.6-flash`.
5. Never add the key to `index.html`, `/api/public-config`, a `PUBLIC_*` variable, or source control.

The server sends the already-compressed photo as inline base64 input. It requests JSON with `response_format`, validates it with Zod, applies word limits and the religious boundary filter, and retries invalid output once. Original image data is not inserted into Supabase.

Official references:

- https://ai.google.dev/gemini-api/docs/image-understanding
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/models
