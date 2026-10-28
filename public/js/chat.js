// Floating chat assistant. Talks only to our own server (/api/chat); the AI key never reaches the browser.
(() => {
  const launcher = document.getElementById('chat-launcher');
  const panel = document.getElementById('chat-panel');
  if (!launcher || !panel) return;

  const messages = document.getElementById('chat-messages');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendBtn = form.querySelector('.chat-send');
  const welcome = messages.innerHTML;
  let loaded = false;
  let busy = false;

  // Text only: replies are inserted with textContent, never as HTML
  function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg-${role}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  async function loadHistory() {
    if (loaded) return;
    loaded = true;
    try {
      const res = await fetch('/api/chat', { headers: { accept: 'application/json' } });
      const data = await res.json();
      data.history.forEach((m) => addMessage(m.role === 'user' ? 'user' : 'bot', m.content));
      if (!data.available) {
        addMessage('error', "The assistant isn't available right now. Please call us instead.");
        input.disabled = true;
        sendBtn.disabled = true;
      }
    } catch {
      // Starting fresh is fine
    }
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    document.getElementById('chat-widget').classList.add('is-open');
    loadHistory();
    input.focus();
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    document.getElementById('chat-widget').classList.remove('is-open');
    launcher.focus();
  }

  launcher.addEventListener('click', () => (panel.hidden ? open() : close()));
  document.getElementById('chat-close').addEventListener('click', close);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  document.getElementById('chat-reset').addEventListener('click', async () => {
    await fetch('/api/chat/reset', { method: 'POST' }).catch(() => {});
    messages.innerHTML = welcome;
    input.focus();
  });

  // Enter sends, Shift+Enter adds a new line; the box grows with the text
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;

    busy = true;
    sendBtn.disabled = true;
    const mine = addMessage('user', text);
    input.value = '';
    input.style.height = 'auto';
    const typing = addMessage('bot', 'Typing…');
    typing.classList.add('is-typing');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (!res.ok) {
        addMessage('error', data.error || 'Something went wrong. Please try again.');
        return;
      }
      if (data.redacted) mine.textContent = data.redacted; // don't leave sensitive data on screen
      addMessage('bot', data.reply);
    } catch {
      typing.remove();
      addMessage('error', "Couldn't reach the assistant. Check your connection and try again.");
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  });
})();
