# Demo video pipeline

Produces `media/tesorero-demo-en.mp4` and `media/tesorero-demo-es.mp4` from one scripted run of the real app.

1. `bash video/audio.sh <work>`: narration with the Windows voices (EN Zira, ES Laura), normalized, with durations.
2. `bash video/stack.sh start <work>`: a fresh local stack. The API on :5080 has the demo tenant seeded and the production base domain (`tesorero.gesco.ec`), so every address the app shows or e-mails is the real one. Without SMTP, e-mails are saved as JSON in `<work>/mail` (`Email:PickupDirectory`).
3. `VIDEO_WORK=<work> node video/record.mjs`: plays the story in Chromium and records high-quality frames (CDP screencast).
   - The browser opens `https://tesorero.gesco.ec`, `https://demo.tesorero.gesco.ec` and the new organization's subdomain. The recorder answers them locally: `frontend/dist` for pages, and the local API for `/api`, keeping the Host header so tenancy works as in production. Nothing leaves the machine.
   - The mail scenes show the exact verification and setup e-mails the API saved.
   - It shows a visible cursor with click ripples and logs every app error it meets.
   - Each scene lasts as long as its longest narration, so the same footage works for both languages.
   - `node video/record.mjs <fromSceneId>` with `STOP_AFTER=<sceneId>` records a slice to try changes. A slice that signs up mutates the database: restart the stack before the full take.
4. `python -I video/compose.py <work> ../media`: builds both 1920×1080 videos. The app takes 1920×972 and the subtitles get their own 108 px band at the bottom (max 2 lines), so they never cover the UI.

The story and narration live in `video/scenes.json`; the scripted actions are in `video/record.mjs`.
