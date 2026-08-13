# AI photo privacy

- A photo is sent to Google Gemini only after the user selects **CONTINUE WITH AI**.
- The photo is used for a single story generation request.
- Return System does not intentionally store the original photo or base64 image in Supabase, server logs, credit transactions, PayPal records, or story-generation metadata.
- The server keeps only validated generated text, visible-fact summaries, relevance, safety flags, model name, request state, and error code.
- The complete story and optional photo remain in the existing local device storage.
- Google is a third-party AI processor. Its applicable API terms and data controls must be reviewed before production launch.
- A user can always choose **USE BASIC REFLECTION INSTEAD**. Basic Reflection remains local and works without login or network access.
