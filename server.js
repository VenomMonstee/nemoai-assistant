import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// serve static frontend
app.use('/', express.static(path.join(process.cwd(), 'public')));

// uploads dir
const uploadsDir = path.join(process.cwd(), 'uploads');
await fs.mkdir(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// multer for non-streaming file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, safe);
  },
});
const upload = multer({ storage });

// initialize OpenAI (NVIDIA Integrate compatible)
if (!process.env.NVIDIA_API_KEY) {
  console.error('Missing NVIDIA_API_KEY in environment. Create a .env file and add NVIDIA_API_KEY=your_key');
  process.exit(1);
}
const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

// small helper to create conversation messages
function makeSystemMessage() {
  return {
    role: 'system',
    content:
      'You are NEMO, a helpful assistant. Be concise and polite. If a file is attached, reference its name and preview/link provided by the server.',
  };
}

/**
 * Non-streaming chat endpoint (supports file attachments, returns final reply)
 * Use this for file uploads and when streaming is not required.
 */
app.post('/api/chat', upload.single('file'), async (req, res) => {
  try {
    const { message } = req.body;
    const file = req.file;

    const messages = [makeSystemMessage()];
    if (message) messages.push({ role: 'user', content: message });

    if (file) {
      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(file.filename)}`;
      // include a small preview for text-like files (server previously implemented preview)
      let fileNote = `File attached: ${file.originalname} (type: ${file.mimetype}, size: ${file.size} bytes). Download: ${fileUrl}`;
      messages.push({ role: 'user', content: fileNote });
    }

    const response = await openai.chat.completions.create({
      model: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
      messages,
      temperature: 0.6,
      top_p: 0.95,
      max_tokens: 1024,
    });

    const assistantMessage = response.choices?.[0]?.message?.content || '';
    res.json({ reply: assistantMessage });
  } catch (err) {
    console.error('chat error', err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * Streaming chat endpoint (text-only message). Streams NDJSON lines:
 * {"token":"..."}
 * final line: {"done":true}
 *
 * The client reads resp.body as a stream and appends tokens in real time.
 */
app.post('/api/chat/stream', async (req, res) => {
  try {
    // accept JSON body; if you use a form, change parser accordingly
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Prepare messages
    const messages = [makeSystemMessage(), { role: 'user', content: message }];

    // set headers for streaming NDJSON
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no'); // for some proxies (nginx) to disable buffering

    // flush headers (if available)
    if (res.flush) res.flush();

    // Request streaming from NVIDIA-integrate / OpenAI-style client
    const completion = await openai.chat.completions.create({
      model: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
      messages,
      temperature: 0.6,
      top_p: 0.95,
      max_tokens: 1024,
      stream: true,
    });

    // If client disconnects, we will stop streaming
    let clientClosed = false;
    req.on('close', () => {
      clientClosed = true;
      // Note: can't reliably cancel the openai async iterator in all libs,
      // but we stop sending more data.
    });

    for await (const chunk of completion) {
      if (clientClosed) break;
      const token = chunk.choices?.[0]?.delta?.content;
      if (token) {
        // write NDJSON line with token
        res.write(JSON.stringify({ token }) + '\n');
      }
    }

    // final done signal
    if (!clientClosed) {
      res.write(JSON.stringify({ done: true }) + '\n');
      res.end();
    }
  } catch (err) {
    console.error('stream error', err);
    try {
      res.write(JSON.stringify({ error: err?.message || String(err) }) + '\n');
    } catch (e) {}
    try { res.end(); } catch (e) {}
  }
});

// health
app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NEMO server running on http://localhost:${PORT}`);
});