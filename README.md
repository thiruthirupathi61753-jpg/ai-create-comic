# ComicCraft Fresh

## Run on Windows
1. Install Node.js (LTS).
2. Open this folder in VS Code.
3. Open Terminal → New Terminal.
4. Run `npm.cmd install`
5. Optional: copy `.env.example` to `.env`, then add your Gemini API key after `GEMINI_API_KEY=`.
6. Run `npm.cmd start`
7. Open http://localhost:3000

Without an API key, the app still generates a built-in demo story. With a valid key, it tries Gemini `gemini-3.8-flash`; if the API is unavailable, it safely falls back to demo generation.
Data is stored in `data.json` in this folder. This is a local student demo, not production authentication.
