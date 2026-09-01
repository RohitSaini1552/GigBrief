import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 5;
const requestTracker = new Map();

const getRateLimitMessage = (resetTime, now) => {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - now) / 1000));
  return {
    error: 'Request rate limit reached or exceeded.',
    message: `Request rate limit reached for this minute. You can make up to ${MAX_REQUESTS} requests in 1 minute. Please wait ${retryAfterSeconds} seconds before trying again.`,
    retryAfterSeconds,
  };
};

const apiLimiter = (req, res, next) => {
  const clientKey = req.ip || 'unknown-ip';
  const now = Date.now();
  const currentData = requestTracker.get(clientKey) || {
    count: 0,
    resetTime: now + RATE_LIMIT_WINDOW_MS,
  };

  if (now > currentData.resetTime) {
    currentData.count = 0;
    currentData.resetTime = now + RATE_LIMIT_WINDOW_MS;
  }

  currentData.count += 1;
  requestTracker.set(clientKey, currentData);

  if (currentData.count === MAX_REQUESTS) {
    logger.warn('Rate limit reached for this user', {
      ip: clientKey,
      route: req.originalUrl,
      limit: MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
  }

  if (currentData.count > MAX_REQUESTS) {
    logger.warn('Rate limit exceeded for this user', {
      ip: clientKey,
      route: req.originalUrl,
      count: currentData.count,
      limit: MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const response = getRateLimitMessage(currentData.resetTime, now);
    return res.status(429).json(response);
  }

  next();
};

app.use('/api', apiLimiter);

app.use((req, res, next) => {
  logger.info('Request started', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
  });
  next();
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.5-flash-lite';

const SYSTEM_PROMPT = `You are a senior freelance project consultant.

Task: Convert a vague client request into a compact, practical project brief for a freelancer.

Return ONLY valid JSON with exactly these keys:
{
  "summary": "1 sentence overview of the likely project",
  "scope": "1 short paragraph explaining the likely project scope and deliverables",
  "techSuggestions": ["brief suggestion 1", "brief suggestion 2", "brief suggestion 3"],
  "redFlags": ["risk 1", "risk 2", "risk 3"],
  "questionsToAsk": ["question 1", "question 2", "question 3"]
}

Rules:
- Use only information reasonably implied by the client request.
- Do not invent brand names, exact features, pricing, or unrealistic scope.
- Keep each array item short, practical, and specific.
- Use 3-5 items per array.
- No markdown, no backticks, no extra text.
- Output must be valid JSON only.`;

app.post('/api/generate', async (req, res) => {
  const startTime = Date.now();
  const { clientInput } = req.body;

  if (!clientInput || !clientInput.trim()) {
    logger.warn('Invalid input received', {
      route: '/api/generate',
      reason: 'clientInput empty',
    });
    return res.status(400).json({ error: 'clientInput is required' });
  }

  if (!GEMINI_API_KEY) {
    logger.error('Gemini API key missing', { route: '/api/generate' });
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server (.env file)' });
  }

  try {
    logger.info('Generating brief', {
      route: '/api/generate',
      inputLength: clientInput.length,
      model: MODEL,
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `${SYSTEM_PROMPT}\n\nClient request: "${clientInput}"` }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Gemini API error', {
        status: response.status,
        details: errText,
        route: '/api/generate',
      });
      return res.status(response.status).json({ error: 'Gemini API error', details: errText });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      logger.error('Unexpected Gemini response shape', {
        route: '/api/generate',
        payload: data,
      });
      return res.status(500).json({ error: 'No content returned from Gemini' });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      logger.error('Failed to parse Gemini JSON', {
        route: '/api/generate',
        rawText,
      });
      return res.status(500).json({ error: 'Failed to parse AI response', raw: rawText });
    }

    const durationMs = Date.now() - startTime;
    logger.info('Brief generated successfully', {
      route: '/api/generate',
      durationMs,
      resultType: typeof parsed,
    });

    res.json(parsed);
  } catch (err) {
    logger.error('Server error', {
      route: '/api/generate',
      message: err.message,
      stack: err.stack,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/health', (req, res) => {
  logger.info('Health check requested', { route: '/api/health' });
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });
}

export { app };