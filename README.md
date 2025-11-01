# NEMO — AI Assistant (NVIDIA Integrate)

A minimal web assistant named "NEMO" that uses the NVIDIA Integrate (OpenAI-compatible) API to generate responses and accepts file attachments. The UI uses a black background and an orange glow for the avatar.

Features:
- Web chat UI
- File attach support (uploads stored on server, text previews included inline when possible)
- Proxy server to call NVIDIA Integrate API (so you don't expose your API key in the browser)

Important: Do NOT commit your NVIDIA API key. Use environment variables.

## Setup

1. Clone or copy the project files.

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the project root with:
   ```
   NVIDIA_API_KEY=your_nvidia_integrate_api_key_here
   PORT=3000
   ```

4. Start the server:
   ```
   npm start
   ```

5. Open your browser to:
   ```
   http://localhost:3000
   ```

## How attachments are handled

- Uploaded files are saved to the `uploads/` directory and served at `/uploads/<filename>`.
- If the uploaded file is a text-like file, the server reads and includes a preview (first ~100 KB) to the model as part of the user message.
- For binary files, the server includes metadata and a download link but does not inline binary content.

## Notes & next steps

- The implementation sends a non-streaming chat completion. If you want streaming to the browser (SSE or websockets), I can add that.
- If you want the assistant to more deeply analyze large files (e.g., run dedicated parsers for PDFs, DOCX, images via OCR, etc.), we can add file-processing steps before sending previews.
- Consider adding size limits and cleanup for `uploads/` in production.

## Security

- Do not expose the API key in frontend code.
- This example stores uploads on disk — for production, consider secured storage and access controls.