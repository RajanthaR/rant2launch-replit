import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind the Replit proxy: trust the first proxy hop so
// `express-rate-limit` keys on the real client IP, not the proxy IP.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        // NOTE: We intentionally do NOT log req.body. Rant text can
        // contain customer names, internal product details, and other
        // founder-private content. If a contributor enables body
        // logging, redact the rawText/timestamps fields first.
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Security headers (HSTS, X-Content-Type-Options, Referrer-Policy, etc).
// crossOriginResourcePolicy is loosened so /api/storage/objects/* can be
// embedded from the share-page frontend on a different host.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // CSP is enforced at the frontend artifact level (Vite/HTML); leave
    // the API headers permissive to avoid blocking JSON consumers.
    contentSecurityPolicy: false,
  }),
);

// CORS — locked to the comma-separated `CORS_ORIGINS` env in prod.
// Unset (typical local dev) falls back to `*` so the dev server still
// works. Production deploys MUST set CORS_ORIGINS.
const allowedOriginsEnv = process.env.CORS_ORIGINS?.trim();
if (allowedOriginsEnv) {
  const allowedOrigins = allowedOriginsEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin / curl (no Origin header) and any explicit
        // allow-listed origin. Reject anything else.
        if (!origin || allowedOrigins.includes(origin)) {
          return cb(null, true);
        }
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    }),
  );
} else {
  app.use(cors());
}

// Explicit body size limit — the rant cap is 50K chars, so 200kb is
// plenty of headroom and well below the default 100kb (which would
// silently 413 on long rants once we add intake metadata).
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));

// Rate limits keyed by IP (uses express-rate-limit's default keyGenerator
// which is IPv6-safe). In-memory store; if/when the app scales to
// multiple instances this should move to Redis.
const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many launches from this IP. Try again in an hour." },
});

const patchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many edits from this IP. Slow down for a minute." },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const ttsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many voiceover previews from this IP. Try again in an hour." },
});

app.use("/api", (req, res, next) => {
  // Routing-aware limiter: the heavy POST /api/projects path eats
  // OpenAI text + 11 image generations per call, so we cap it hard.
  if (req.method === "POST" && /^\/projects\b/.test(req.path)) {
    return writeLimiter(req, res, next);
  }
  if (req.method === "POST" && req.path === "/audio/tts") {
    return ttsLimiter(req, res, next);
  }
  if (req.method === "PATCH" || req.method === "DELETE") {
    return patchLimiter(req, res, next);
  }
  if (req.method === "GET") {
    return readLimiter(req, res, next);
  }
  return next();
});

app.use("/api", router);

export default app;
