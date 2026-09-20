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
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TRANSIENT_GEMINI_STATUSES = new Set([429, 500, 502, 503, 504]);

const SYSTEM_PROMPT = `You are GigBrief, a senior freelance pre-sales and product discovery analyst.

Task: Turn a vague client request into a practical decision brief. Help a freelancer understand what to build, define a realistic MVP, and choose a sensible first architecture before discussing price or delivery.

Return ONLY valid JSON with exactly these keys:
{
  "projectTitle": "short descriptive name",
  "oneLiner": "one sentence explaining the product and its primary user",
  "problem": "the likely problem or outcome the client cares about",
  "mvp": ["must-have capability 1", "must-have capability 2", "must-have capability 3"],
  "userFlow": ["step 1", "step 2", "step 3", "step 4"],
  "architecture": {
    "recommendation": "the simplest appropriate architecture for this MVP",
    "frontend": "framework and responsibility",
    "backend": "framework and responsibility",
    "data": "storage choice and the core entities or records",
    "integrations": ["external service or integration, or state that none is required"]
  },
  "deliveryPlan": ["first milestone", "second milestone", "third milestone"],
  "assumptions": ["important assumption 1", "important assumption 2", "important assumption 3"],
  "questionsToAsk": ["specific client question 1", "specific client question 2", "specific client question 3"],
  "outOfScope": ["feature to exclude from the first release", "another feature to defer"]
}

Rules:
- Use only information reasonably implied by the client request. Mark uncertainty as an assumption instead of inventing details.
- Keep the MVP intentionally small and explainable. Recommend the simplest architecture that can validate the idea.
- Do not invent brand names, exact pricing, user counts, or unrealistic requirements.
- Use 3-5 concise items in each array. Keep architecture values brief and practical.
- No markdown, no backticks, no extra text. Output must be valid JSON only.`;

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

    const requestBody = {
      contents: [
        {
          parts: [{ text: `${SYSTEM_PROMPT}\n\nClient request: "${clientInput}"` }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    };
    const geminiUrl = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
    );
    geminiUrl.searchParams.set('key', GEMINI_API_KEY);

    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (response.ok || !TRANSIENT_GEMINI_STATUSES.has(response.status) || attempt === 2) {
        break;
      }

      const retryDelayMs = 1000 * (attempt + 1);
      logger.warn('Transient Gemini response; retrying', {
        status: response.status,
        attempt: attempt + 1,
        retryDelayMs,
        route: '/api/generate',
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

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