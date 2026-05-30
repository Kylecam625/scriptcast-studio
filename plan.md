Build a polished MVP web app called ScriptCast Studio.

Goal:
Create a web app where users paste/upload messy raw text and the app automatically turns it into a multi-character ElevenLabs audio project. It should detect characters, fill character boxes, suggest voices, optionally add delivery tags, generate audio chunks, and export one final audio file.

Stack:
- Next.js + React + TypeScript
- Server-only API routes
- OpenAI API for raw text parsing and optional TTS enhancement
- ElevenLabs API for voice search/design and Text to Dialogue generation
- FFmpeg for audio merging
- Zod for schemas
- SQLite/Prisma or simple file/local persistence
- Mock mode for tests if API keys are missing

Core user flow:
1. Upload/Paste
   - User can paste text or upload .txt/.md.
   - Include a “Try sample script” button.

2. Parse Review
   - Backend sends raw text to OpenAI using strict structured output.
   - Output includes title, detected format, confidence, characters, turns, warnings.
   - UI shows raw text on left and parsed turns on right.
   - User can rename/merge characters, assign speakers, and mark narration/stage directions.

3. Cast Voices
   - For each character, show a card with inferred traits and suggested voice.
   - AI creates voiceSearchQuery and voiceDesignPrompt.
   - Backend searches ElevenLabs voices and returns real voice_id choices.
   - User can preview/change voice.
   - Do not invent voice IDs.

4. Delivery Style
   - Presets: Natural, Anime/Dramatic, Podcast, Audiobook, Game Dialogue, Cinematic.
   - Optional enhancement adds sparse ElevenLabs v3 tags like [sighs], [whispers], [nervous], [laughs].
   - Preserve originalText separately from ttsText.
   - Never rewrite dialogue unless user explicitly asks.

5. Generate
   - Chunk turns under 1,800 total chars and max 10 unique voices per chunk.
   - Use ElevenLabs Text to Dialogue for multi-speaker chunks.
   - Save chunk audio files.
   - Merge chunks into one final MP3 with FFmpeg.
   - Show progress.

6. Export
   - User can play final audio.
   - User can download MP3.
   - User can go back and regenerate a single chunk/line.

Backend routes:
- POST /api/parse
- POST /api/enhance
- GET /api/voices/search
- POST /api/voices/design
- POST /api/generate
- GET /api/generate/:jobId
- GET /api/export/:projectId

Data models:
Character:
id, name, aliases, inferredTraits, voiceSearchQuery, voiceDesignPrompt, selectedVoiceId, selectedVoiceName

Turn:
id, order, type, speakerId, originalText, ttsText, emotionHint, needsReview

Chunk:
id, order, turnIds, charCount, uniqueVoiceIds, status, audioPath

Project:
id, title, rawText, parseResult, characters, turns, chunks, finalAudioPath, createdAt, updatedAt

Testing:
- Add sample scripts.
- Test parser schema validation.
- Test chunking under 1,800 chars and 10 voices.
- Test mock audio generation and final merge.
- Build must pass.
- Do not call real OpenAI or ElevenLabs in tests.

Security:
- API keys only in server env vars.
- Never expose keys in client code.
- Add .env.example.
- Add clear error states if keys are missing.
- Mock mode should still let the app demo fully.

UI style:
Clean, modern, simple. Use stepper layout:
Upload -> Review Parse -> Cast Voices -> Generate -> Export.
Avoid clutter. Hide advanced controls in collapsible sections.
Make the app feel like the AI is filling out the boring boxes for the user, not like the user is configuring NASA telemetry.

Before finishing:
- Run install/build/test commands.
- Fix TypeScript errors.
- Review the diff.
- Document setup in README.
- Include a sample input script.