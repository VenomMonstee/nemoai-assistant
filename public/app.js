// Client-side streaming reader (NDJSON) and UI token appender.
// This file replaces the previous public/app.js streaming logic.

const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const messageInput = document.getElementById('message');
const fileInput = document.getElementById('file');
const fileNameEl = document.getElementById('file-name');
const clearFileBtn = document.getElementById('clear-file');

function appendMessage(text, who='assistant') {
  const div = document.createElement('div');
  div.className = 'msg ' + (who === 'user' ? 'user' : 'assistant');
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function setFileName(name) {
  if (!name) {
    fileNameEl.textContent = 'No file chosen';
    fileNameEl.title = '';
    clearFileBtn.style.display = 'none';
  } else {
    fileNameEl.textContent = name;
    fileNameEl.title = name;
    clearFileBtn.style.display = 'inline-flex';
  }
}
setFileName(null);

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  setFileName(file ? file.name : null);
});
clearFileBtn.addEventListener('click', () => {
  fileInput.value = '';
  setFileName(null);
});

// Helper: stream a message using /api/chat/stream and append tokens in real time.
// Falls back to non-streaming endpoint for file uploads.
async function streamMessage(messageText) {
  const resp = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: messageText }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('Stream request failed: ' + text);
  }

  // Create an assistant message element and append tokens progressively
  const assistantEl = appendMessage('', 'assistant');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // NDJSON split by newline — parse complete lines
    const parts = buffer.split('\n');
    buffer = parts.pop(); // last partial line remains
    for (const line of parts) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.token) {
          assistantEl.textContent += obj.token;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } else if (obj.done) {
          // finished
        } else if (obj.error) {
          assistantEl.textContent += '\n\nError: ' + obj.error;
        }
      } catch (e) {
        // ignore JSON parse errors for partial data
        console.warn('NDJSON parse error', e, line);
      }
    }
  }

  // process remaining buffer (if any)
  if (buffer.trim()) {
    try {
      const obj = JSON.parse(buffer);
      if (obj.token) assistantEl.textContent += obj.token;
    } catch (e) { /* ignore */ }
  }
}

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  const file = fileInput.files[0];

  if (!text && !file) return;

  if (text) appendMessage(text, 'user');
  if (file) appendMessage(`📎 Attached file: ${file.name}`, 'user');

  // If there's a file, use non-streaming /api/chat endpoint (file uploads)
  if (file) {
    const fd = new FormData();
    fd.append('message', text);
    fd.append('file', file);
    messageInput.value = '';
    fileInput.value = '';
    setFileName(null);
    appendMessage('…NEMO is thinking...', 'assistant');
    try {
      const resp = await fetch('/api/chat', { method: 'POST', body: fd });
      const data = await resp.json();
      const last = messagesEl.querySelector('.msg.assistant:last-child');
      if (last && last.textContent.startsWith('…NEMO')) last.remove();
      if (data.error) appendMessage('Error: ' + data.error, 'assistant');
      else appendMessage(data.reply || '(no response)', 'assistant');
    } catch (err) {
      const last = messagesEl.querySelector('.msg.assistant:last-child');
      if (last && last.textContent.startsWith('…NEMO')) last.remove();
      appendMessage('Network/server error. See console.', 'assistant');
      console.error(err);
    }
    return;
  }

  // Text-only: use streaming endpoint
  messageInput.value = '';
  appendMessage('…NEMO is thinking...', 'assistant');
  try {
    await streamMessage(text);
  } catch (err) {
    const last = messagesEl.querySelector('.msg.assistant:last-child');
    if (last && last.textContent.startsWith('…NEMO')) last.remove();
    appendMessage('Error streaming response: ' + err.message, 'assistant');
    console.error(err);
  }
});