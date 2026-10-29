const express = require('express');
const { assistant } = require('../lib/gym');
const assistantService = require('../services/assistantService');
const { createLimiter } = require('../lib/rateLimit');

const router = express.Router();
router.use(express.json({ limit: '4kb' }));

const MAX_MESSAGE_LENGTH = 800;
const MAX_TURNS_SENT = 10;          // earlier turns are dropped from what the model sees
const LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LIMIT_PER_SESSION = 20;       // messages per visitor per 10 minutes

// Backstop for visitors who drop their cookie
const perIp = createLimiter({ windowMs: LIMIT_WINDOW_MS, max: 60 });

// Per-visitor count, kept in the session
function overSessionLimit(req, now) {
  const recent = (req.session.chatHits || []).filter((t) => now - t < LIMIT_WINDOW_MS);
  if (recent.length >= LIMIT_PER_SESSION) return true;
  req.session.chatHits = [...recent, now];
  return false;
}

// The conversation lives in the server-side session, so visitors can't forge earlier assistant turns
const historyOf = (req) => (req.session.chat ||= []);

router.get('/', (req, res) => {
  res.json({ name: assistant.name, available: assistantService.isConfigured(), history: req.session.chat || [] });
});

router.post('/', async (req, res) => {
  if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' });

  const raw = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!raw) return res.status(400).json({ error: 'Type a message first.' });
  if (raw.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Please keep messages under ${MAX_MESSAGE_LENGTH} characters.` });
  }
  if (!assistantService.isConfigured()) {
    return res.status(503).json({ error: "The assistant isn't available right now. Please call us instead." });
  }

  if (overSessionLimit(req, Date.now()) || perIp.hit(req.ip)) {
    return res.status(429).json({ error: "You've sent a lot of messages. Please wait a few minutes and try again." });
  }

  // Card numbers, Emirates IDs and passwords never reach the AI provider or the stored history
  const { text, removed } = assistantService.redactSensitive(raw);
  const history = historyOf(req);
  history.push({ role: 'user', content: text });

  try {
    const answer = await assistantService.reply(history.slice(-(MAX_TURNS_SENT * 2 + 1)));
    history.push({ role: 'assistant', content: answer });
    if (history.length > 40) history.splice(0, history.length - 40);
    res.json({ reply: answer, redacted: removed.length ? text : null });
  } catch (err) {
    history.pop(); // keep user/assistant turns paired so the next message works
    if (err instanceof assistantService.AssistantError) {
      const status = err.code === 'RATE_LIMITED' ? 429 : 503;
      return res.status(status).json({ error: `${err.message} Please try again in a moment, or call us.` });
    }
    console.error('Chat failed:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/reset', (req, res) => {
  delete req.session.chat;
  res.json({ ok: true });
});

module.exports = router;
