# PROJECT CODE WALKTHROUGH — Personal AI Coach

> **Purpose of this file:** A complete, file-by-file, line-by-line code walkthrough of the **Personal AI Coach** repository (`raghavgupta759/personal-ai-coach`). Every code snippet in this document is copied directly from the actual repository files, and every explanation is written in simple English + easy Hinglish so you can explain any file confidently in an interview.

---

## Table of Contents

1. [Backend Entry Point — `server.ts`](#1-backend-entry-point--serverts)
2. [Database Schema & Seeding — `server/db.ts`](#2-database-schema--seeding--serverdbts)
3. [Authentication & Session Store — `server/auth.ts`](#3-authentication--session-store--serverauthts)
4. [REST API & SSE Streaming Routes — `server/routes.ts`](#4-rest-api--sse-streaming-routes--serverroutests)
5. [AI Engine & Prompt Engineering — `server/ai.ts`](#5-ai-engine--prompt-engineering--serveraits)
6. [Company Research Adapter — `server/search.ts`](#6-company-research-adapter--serversearchts)
7. [PDF Study Pack Generator — `server/pdf.ts`](#7-pdf-study-pack-generator--serverpdfts)
8. [Automated Backend Tests — `server/logic.test.ts`](#8-automated-backend-tests--serverlogictestts)
9. [Frontend Root & Routing — `src/App.tsx`](#9-frontend-root--routing--srcapptsx)
10. [Frontend API & Streaming Client — `src/api.ts`](#10-frontend-api--streaming-client--srcapits)
11. [Shared TypeScript Interfaces — `src/types.ts`](#11-shared-typescript-interfaces--srctypests)
12. [Resume & JD Analysis UI — `src/components/AnalysisView.tsx`](#12-resume--jd-analysis-ui--srccomponentsanalysisviewtsx)
13. [Mock Interview Arena UI — `src/components/InterviewView.tsx`](#13-mock-interview-arena-ui--srccomponentsinterviewviewtsx)
14. [Ask Me AI Coach Chat UI — `src/components/CoachView.tsx`](#14-ask-me-ai-coach-chat-ui--srccomponentscoachviewtsx)
15. [Custom Streaming Markdown Renderer — `src/components/MarkdownContent.tsx`](#15-custom-streaming-markdown-renderer--srccomponentsmarkdowncontenttsx)
16. [Other UI Views (`AuthModal`, `DashboardView`, `CompanyResearchView`, `StudyPacksView`, `HistoryView`, `SettingsView`, `Navbar`, `LandingView`)](#16-other-ui-views)
17. [Configuration & Deployment Files (`package.json`, `vite.config.ts`, `Dockerfile`, `render.yaml`)](#17-configuration--deployment-files)

---

## 1. Backend Entry Point — `server.ts`

FILE: `server.ts`

PURPOSE:
This is the main starting point of the entire application. When you run `npm run dev` or `npm start`, Node.js runs `server.ts`. It initializes the SQLite database, sets up Express middleware to read JSON bodies, mounts all `/api/*` backend routes, serves either the Vite dev server (in development) or the built `dist/` frontend files (in production), and starts listening on port `3000` (or `process.env.PORT`) on host `0.0.0.0`.

COMMUNICATES WITH:
- `server/db.ts` (calls `initDatabase()`)
- `server/routes.ts` (mounts `apiRouter` on `/api`)
- `vite` (dynamically imported in dev mode for `middlewareMode: true`)
- `dist/index.html` (served statically in production mode)

IMPORTANT CODE:

```typescript
async function startServer() {
  // Initialize SQLite tables and seed data
  initDatabase();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Middleware
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // API Router
  app.use('/api', apiRouter);

  // Frontend integration
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Development mode: Vite middleware integration
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Personal AI Coach Full-Stack Server running at http://0.0.0.0:${PORT}`);
    console.log(`- Database: Persistent SQLite (data/personal_ai_coach.db)`);
    console.log(`- Gemini AI: ${process.env.GEMINI_API_KEY ? 'Configured' : 'Offline / Deterministic Fallback'}`);
    console.log(`- Demo account ready: raghav@example.com / Password123!\n`);
  });
}
```

LINE-BY-LINE EXPLANATION:
- `initDatabase()`: Before accepting any HTTP requests, the server ensures all 8 SQLite tables exist and seeds the demo user (`raghav@example.com`) if the database is empty.
- `const app = express()`: Creates an Express application instance.
- `const PORT = Number(process.env.PORT) || 3000`: Reads `PORT` from environment variables (cloud platforms like Render inject `PORT`, e.g., `10000`), falling back to `3000` locally and in AI Studio.
- `app.use(express.json({ limit: '15mb' }))`: Parses incoming JSON request bodies up to 15 MB (needed when users paste large resume or job description text).
- `app.use('/api', apiRouter)`: Sends any request starting with `/api` (like `/api/auth/login`, `/api/analysis`, `/api/coach/chat/stream`) to the API router defined in `server/routes.ts`.
- `if (process.env.NODE_ENV === 'production')`: In production, Express serves the compiled frontend bundle from `dist/` and uses `app.get('*')` as a Single Page Application (SPA) fallback so React handles routing.
- `else { ... createViteServer(...) }`: In development, Express dynamically imports Vite in `middlewareMode: true` so one single server process on port 3000 serves both the React frontend and the Express API—avoiding CORS issues and needing two separate ports. `allowedHosts: true` ensures reverse proxies (like AI Studio preview URLs) are not blocked by Vite's host check.
- `app.listen(PORT, '0.0.0.0', ...)`: Binds the server to all network interfaces (`0.0.0.0`) so external requests/containers can reach it.

INTERVIEW QUESTION:
Why did you mount Vite inside Express (`server.ts`) instead of running frontend and backend on two separate servers?

ANSWER:
Running Vite in `middlewareMode` inside Express lets a single Node.js process on port 3000 serve both the React SPA and all `/api/*` REST and SSE endpoints. That eliminates CORS configuration headaches during development, simplifies deployment to a single `npm start` command on Render or Docker, and keeps `GEMINI_API_KEY` strictly on the backend.

PRACTICAL EXAMPLE:
When a user opens the app URL in their browser, `GET /` does not match `/api`, so Express passes it to `vite.middlewares` (in dev) or `dist/index.html` (in prod), loading React. When React then calls `fetch('/api/me')`, the request hits the same origin on port 3000 and is handled by `apiRouter`.

---

## 2. Database Schema & Seeding — `server/db.ts`

FILE: `server/db.ts`

PURPOSE:
Sets up and exports the SQLite database connection using Node.js 22's built-in `node:sqlite` (`DatabaseSync`), creates the 8 database tables and 5 indexes on startup, and seeds a realistic demo profile (`raghav@example.com` / `Password123!`) with a sample resume, Stripe job description, completed analysis, mock interview session, and coach conversation.

COMMUNICATES WITH:
- `server.ts` (calls `initDatabase()`)
- `server/auth.ts` (queries `app_users` and inserts into `audit_events`)
- `server/routes.ts` (performs all CRUD queries via imported `db`)
- `server/logic.test.ts` (tests schema initialization and demo user seeding)

IMPORTANT CODE:

```typescript
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'personal_ai_coach.db');
export const db = new DatabaseSync(DB_PATH);

// Enable foreign keys and WAL mode for reliability
db.exec('PRAGMA foreign_keys = ON;');
```

And the table creation + seeding pattern:

```typescript
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      preferred_language TEXT NOT NULL DEFAULT 'en',
      target_role TEXT,
      target_company TEXT,
      experience_level TEXT,
      email_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ...
  `);

  seedDemoDataIfEmpty();
}
```

LINE-BY-LINE EXPLANATION:
- `import { DatabaseSync } from 'node:sqlite'`: Uses Node.js 22's native synchronous SQLite driver instead of third-party native C++ addons like `better-sqlite3`, avoiding `node-gyp` build failures across Linux/Docker containers.
- `fs.mkdirSync(DATA_DIR, { recursive: true })`: Automatically creates the `data/` folder if it does not exist yet.
- `export const db = new DatabaseSync(DB_PATH)`: Opens/creates `data/personal_ai_coach.db` and exports the connection for reuse across backend modules.
- `db.exec('PRAGMA foreign_keys = ON;')`: SQLite disables foreign key checks by default; turning this `ON` ensures `ON DELETE CASCADE` works when a user deletes their account (automatically cleaning up their documents, analyses, interviews, chats, and study packs).
- `seedDemoDataIfEmpty()`: Checks `SELECT id FROM app_users WHERE email = 'raghav@example.com'`. If missing, hashes `'Password123!'` with `bcrypt.hashSync` and inserts demo documents, analysis, interview turns, and chat history so reviewers can test the app with 1 click.

INTERVIEW QUESTION:
Why did you use `node:sqlite` (`DatabaseSync`) instead of PostgreSQL or `better-sqlite3`?

ANSWER:
`node:sqlite` ships built into Node.js 22+, requires zero external database server setup and zero native C++ compilation (`node-gyp`), and runs fast in-process with full SQL and foreign-key support. For a multi-instance production deployment, I would migrate to PostgreSQL (already sketched in `public/assets/aistudio/DATABASE_SCHEMA_1f7a7281.sql`) so state is shared across servers and survives ephemeral container restarts.

PRACTICAL EXAMPLE:
When a brand-new container boots up, `initDatabase()` creates `data/personal_ai_coach.db`, creates all 8 tables, and seeds Raghav's Stripe demo workspace in a few milliseconds.

---

## 3. Authentication & Session Store — `server/auth.ts`

FILE: `server/auth.ts`

PURPOSE:
Manages user authentication tokens in memory, validates Bearer tokens on protected API routes via the `authenticate` Express middleware, and records sanitized audit events in SQLite.

COMMUNICATES WITH:
- `server/db.ts` (reads `app_users`, writes `audit_events`)
- `server/routes.ts` (uses `authenticate`, `createSession`, `revokeSession`, `logAuditEvent`)
- `server/logic.test.ts` (unit-tests `createSession`, `getUserFromToken`, `revokeSession`)

IMPORTANT CODE:

```typescript
interface SessionRecord {
  userId: string;
  createdAt: number;
  expiresAt: number;
}
const sessions = new Map<string, SessionRecord>();

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  sessions.set(token, {
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + sevenDays,
  });
  return token;
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-session-token']) {
    token = String(req.headers['x-session-token']).trim();
  }

  if (!token) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required to access this resource.' }
    });
  }

  const user = getUserFromToken(token);
  if (!user) {
    return res.status(401).json({
      error: { code: 'SESSION_EXPIRED', message: 'Session invalid or expired. Please sign in again.' }
    });
  }

  (req as any).user = user;
  (req as any).token = token;
  next();
}
```

LINE-BY-LINE EXPLANATION:
- `const sessions = new Map<string, SessionRecord>()`: Stores active sessions in server RAM, mapping a random 64-character hex string to `{ userId, createdAt, expiresAt }`. (Note: this is an opaque stateful token, NOT a JWT.)
- `crypto.randomBytes(32).toString('hex')`: Generates a cryptographically secure 256-bit random token that cannot be guessed.
- `sessionCleaner = setInterval(...)`: Runs every hour (`.unref()` so it doesn't keep Node alive during shutdown/tests) to remove expired sessions.
- `authenticate`: Express middleware that extracts the token from `Authorization: Bearer <token>` (or `x-session-token`), calls `getUserFromToken(token)` to check expiration and fetch the user row from SQLite, attaches `req.user` and `req.token`, and calls `next()`. If invalid/missing, it immediately stops the request with HTTP `401`.
- `logAuditEvent`: Strips sensitive keys (`password`, `token`, `password_hash`, `extractedText`) before saving an event into `audit_events`.

INTERVIEW QUESTION:
Does this project use JWTs for authentication? What happens if the server restarts?

ANSWER:
No, it uses opaque random 256-bit tokens stored in an in-memory `Map` in `server/auth.ts`, not JWTs. Because the `Map` lives only in Node.js memory, a server restart clears all active sessions and logs users out. In production, I would move sessions into Redis or a database `sessions` table, or switch to signed JWTs with refresh tokens.

PRACTICAL EXAMPLE:
When a user clicks "Sign Out", `POST /api/auth/logout` runs `authenticate`, reads `(req as any).token`, and calls `revokeSession(token)` which deletes that entry from the `sessions` `Map`, immediately invalidating the token.

---

## 4. REST API & SSE Streaming Routes — `server/routes.ts`

FILE: `server/routes.ts`

PURPOSE:
Defines all 23 backend API endpoints under `/api/*`, including health/readiness checks, auth, file upload & text extraction (`multer`, `pdf-parse`, `mammoth`), resume vs. JD analysis, company research, mock interviews, real-time SSE AI Coach streaming, and PDF study pack downloads.

COMMUNICATES WITH:
- `server.ts` (mounted at `/api`)
- `server/db.ts`, `server/auth.ts`, `server/ai.ts`, `server/search.ts`, `server/pdf.ts`

IMPORTANT CODE:

1. **File Upload & Extraction (`multer`, `pdf-parse`, `mammoth`)**:

```typescript
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/msword',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(pdf|docx|txt)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Please upload PDF, DOCX, or TXT file.'));
    }
  },
});

async function extractTextFromBuffer(buffer: Buffer, mimetype: string, filename: string): Promise<string> {
  const isPdf = mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
  const isDocx = mimetype.includes('wordprocessingml') || filename.toLowerCase().endsWith('.docx');

  if (isPdf) {
    try {
      const PDFParseClass: any = (pdfParseModule as any).PDFParse || (pdfParseModule as any).default || pdfParseModule;
      if (typeof PDFParseClass === 'function') {
        const parser = new PDFParseClass({ data: buffer });
        if (parser.load) await parser.load();
        const text = parser.getText ? await parser.getText() : '';
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      }
      return '[Scanned or image-only PDF detected. Please review and paste the text manually in the editor below.]';
    } catch (err: any) {
      return '[Could not automatically extract text from this PDF. Please paste your resume text in the editor below.]';
    }
  }

  if (isDocx) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim();
    } catch (err: any) {
      return '[Could not automatically extract text from this DOCX. Please paste your resume text in the editor below.]';
    }
  }

  return buffer.toString('utf-8');
}
```

2. **Server-Sent Events (SSE) Streaming Route (`/api/coach/chat/stream`)**:

```typescript
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let isAborted = false;
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      isAborted = true;
      abortController.abort();
    }
  });

  const sendEvent = (data: any) => {
    if (isAborted || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  };
```

LINE-BY-LINE EXPLANATION:
- `multer({ limits: { fileSize: 10 * 1024 * 1024 } })`: Keeps uploaded files in RAM (`Buffer` in `req.file.buffer`) instead of writing temporary files to disk, capped at 10 MB, and filters by MIME type/extension.
- `extractTextFromBuffer`: Routes `.pdf` to `pdf-parse` (`PDFParse`), `.docx` to `mammoth.extractRawText`, and `.txt` to UTF-8 string decoding. If a PDF is image-only/scanned or corrupt, it gracefully returns a helpful prompt message instead of crashing.
- `res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')`: Tells the browser/proxy this HTTP response is an open Server-Sent Events stream, not a single JSON blob. `X-Accel-Buffering: no` disables proxy buffering (important on Nginx/Render) so chunks reach the browser immediately.
- `res.on('close', () => abortController.abort())`: Detects if the user clicked "Stop" or closed the browser tab mid-stream and aborts the Gemini stream. If partial text was generated before abort, `routes.ts` saves it with `*(generation paused)*`.
- `sendEvent(data)`: Formats each message as `data: <JSON>\n\n` following the SSE specification.

INTERVIEW QUESTION:
How do you make sure one user cannot read or delete another user's analysis or mock interview?

ANSWER:
Every protected endpoint uses the `authenticate` middleware to resolve `(req as any).user.id` from the session token, and every SQLite query scopes by `WHERE id = ? AND user_id = ?` (for example in `GET /api/analysis/:id`, `GET /api/interviews/:id`, `DELETE /api/study-packs/:id`). Even if an attacker guesses another user's UUID, the query returns no rows and responds with `404`.

PRACTICAL EXAMPLE:
When Raghav uploads a PDF resume on the Analysis page, `POST /api/documents/resume` runs `authenticate`, parses the file buffer in memory via `multer`, extracts text via `pdf-parse`, saves it in the `documents` table with Raghav's `user_id`, and returns `documentId` and `extractedText`.

---

## 5. AI Engine & Prompt Engineering — `server/ai.ts`

FILE: `server/ai.ts`

PURPOSE:
Houses all server-side calls to Google's `@google/genai` SDK. Implements 4 core AI capabilities: (1) Resume & JD gap analysis (`analyzeResumeAndJd`), (2) One-question-at-a-time adaptive interview generation (`generateQuestion`), (3) 8-dimension rubric answer evaluation (`evaluateAnswer`), and (4) Contextual AI Coach chat + streaming (`coachChat` and `coachChatStream`), plus deterministic fallback functions if `GEMINI_API_KEY` is absent or API calls fail.

COMMUNICATES WITH:
- `server/routes.ts` (imports all 5 exported AI functions)
- Google Gemini API (outbound HTTPS via `@google/genai`)

IMPORTANT CODE:

```typescript
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getCandidateModels(): string[] {
  const preferred = process.env.GEMINI_MODEL;
  const list = [preferred, 'gemini-3.1-flash-lite', 'gemini-3.8-flash'].filter(Boolean) as string[];
  return Array.from(new Set(list));
}

async function generateWithModelFallback(params: {
  contents: any;
  config?: any;
}): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  const models = getCandidateModels();
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });
      if (response && response.text && response.text.trim().length > 0) {
        return response.text;
      }
    } catch (err: any) {
      console.warn(
        `Gemini model [${model}] attempt failed (${err?.status || err?.message?.slice(0, 80)}). Trying next model...`
      );
    }
  }
  return null;
}
```

And the JSON extraction helper:

```typescript
function safeParseJson<T>(rawText: string, fallback: T): T {
  try {
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    const match = rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return JSON.parse(match[1]) as T;
      } catch {}
    }
    return fallback;
  }
}
```

LINE-BY-LINE EXPLANATION:
- `getGeminiClient()`: Reads `process.env.GEMINI_API_KEY`. If missing, returns `null` rather than throwing, allowing the app to fall back gracefully.
- `getCandidateModels()`: Builds an ordered deduplicated list starting with `process.env.GEMINI_MODEL` (if set), followed by `'gemini-3.1-flash-lite'` and `'gemini-3.8-flash'`.
- `generateWithModelFallback`: Loops through candidate models. If one model fails (rate limit, quota, outage), it catches the error, logs a warning, and tries the next model. If all fail, returns `null` so the caller uses deterministic local fallbacks (`fallbackAnalyze`, `fallbackQuestion`, `fallbackFeedback`).
- `safeParseJson`: Strips markdown code fences (```` ```json ````), attempts `JSON.parse`, and if extra text surrounds the JSON, uses regex to extract the `{...}` or `[...]` block—falling back to `fallback` if parsing still fails.
- Structured Outputs: For analysis, question generation, and evaluation, `config.responseMimeType: 'application/json'` and `config.responseSchema` (using `Type` from `@google/genai`) instruct Gemini to return strictly typed JSON matching TypeScript interfaces.

INTERVIEW QUESTION:
What happens if the Gemini API is down or returns malformed JSON?

ANSWER:
Every AI function in `server/ai.ts` has two layers of resilience: first, `generateWithModelFallback` tries multiple Gemini models sequentially; second, `safeParseJson` strips markdown fences and rescues JSON substrings, and if everything still fails or `GEMINI_API_KEY` is missing, deterministic fallback functions (`fallbackAnalyze`, `fallbackQuestion`, `fallbackFeedback`, `generateContextualCoachFallback`) return valid structured data so the user flow never crashes.

PRACTICAL EXAMPLE:
When a candidate submits a mock interview answer, `evaluateAnswer` sends the question, answer, and up to 3,000 characters of resume context to Gemini with an 8-dimension `responseSchema`. Even if the model call fails offline, `fallbackFeedback` inspects word count and technical keywords (`because|database|api|...`) to return a valid 8-score rubric.

---

## 6. Company Research Adapter — `server/search.ts`

FILE: `server/search.ts`

PURPOSE:
Provides company background, tech stack, culture notes, sourced public facts (with source title, URL, date, and type), and clearly labeled practice questions.

COMMUNICATES WITH:
- `server/routes.ts` (called by `POST /api/company-research` and `POST /api/study-packs`)
- `server/logic.test.ts` (tested for citations and `isVerifiedHistoricalQuestion === false`)

IMPORTANT CODE:

```typescript
export async function researchCompany(companyName: string, targetRole: string): Promise<CompanyResearchResult> {
  const norm = companyName.trim().toLowerCase();
  const today = new Date().toISOString().split('T')[0];

  // Check verified database first
  const known = Object.keys(VERIFIED_COMPANY_DATA).find(k => norm.includes(k) || k.includes(norm));
  const base = known ? VERIFIED_COMPANY_DATA[known] : null;

  // Attempt public web search via DuckDuckGo Instant Answer API
  let liveSourcedFacts: CompanyFact[] = [];
  let isSearchLive = false;
  try {
    const encoded = encodeURIComponent(`${companyName} company overview engineering`);
    const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`, {
      headers: { 'User-Agent': 'PersonalAICoach/1.0' },
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.AbstractText && data.AbstractURL) {
        liveSourcedFacts.push({
          claim: data.AbstractText.slice(0, 300) + '...',
          sourceTitle: data.Heading || `${companyName} Public Encyclopedia Profile`,
          sourceUrl: data.AbstractURL,
          sourceDate: today,
          sourceType: 'third_party',
          confidence: 'high'
        });
        isSearchLive = true;
      }
    }
  } catch (err) {
    isSearchLive = false;
  }
```

LINE-BY-LINE EXPLANATION:
- `VERIFIED_COMPANY_DATA`: A hardcoded in-file dictionary currently containing curated official citations for `stripe` and `google`.
- `fetch('https://api.duckduckgo.com/...')`: Queries DuckDuckGo's free Instant Answer JSON API with a strict 3-second timeout (`AbortSignal.timeout(3000)`) so slow network requests never hang the UI.
- `isVerifiedHistoricalQuestion: false`: Explicitly marks every generated practice question as a simulation (never falsely claiming "this was leaked from Stripe's interview").

INTERVIEW QUESTION:
How does your company research feature avoid fabricating company facts or claiming fake leaked questions?

ANSWER:
In `server/search.ts`, verified facts come either from a curated source dictionary (`VERIFIED_COMPANY_DATA` for Stripe and Google) or live DuckDuckGo Instant Answer responses, each tagged with `sourceTitle`, `sourceUrl`, `sourceDate`, and `sourceType`. Practice questions always have `isVerifiedHistoricalQuestion: false` and include a `limitationsNote` warning users they are simulations.

PRACTICAL EXAMPLE:
Searching "Stripe" merges Stripe's official Annual Letter / API Idempotency / Sorbet citations with any live DuckDuckGo abstract, while searching an unlisted company falls back to DuckDuckGo + generic engineering preparation templates.

---

## 7. PDF Study Pack Generator — `server/pdf.ts`

FILE: `server/pdf.ts`

PURPOSE:
Uses `jsPDF` on the Node.js server to build a formatted multi-page A4 PDF study guide (`Buffer`) combining the candidate's analysis, company research, technical questions, behavioral STAR outlines, 7-day plan, and revision checklist.

COMMUNICATES WITH:
- `server/routes.ts` (called by `GET /api/study-packs/:id/download`)
- `server/logic.test.ts` (verifies `%PDF-` header and buffer length > 1000)

IMPORTANT CODE:

```typescript
export function generateStudyPackPdf(data: StudyPackData): Buffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });
  ...
  function checkPageBreak(neededHeight: number) {
    if (y + neededHeight > pageHeight - margin - 30) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
  }
  ...
  const totalPages = doc.internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Personal AI Coach • Confidential & Personalized for ${data.userName}`, margin, pageHeight - 15);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 15, { align: 'right' });
  }

  const outputArrayBuffer = doc.output('arraybuffer');
  return Buffer.from(outputArrayBuffer);
}
```

LINE-BY-LINE EXPLANATION:
- `new jsPDF(...)`: Initializes an A4 portrait PDF measured in points (`pt`).
- `checkPageBreak(neededHeight)`: Tracks vertical cursor `y`; before drawing a block, checks if it would overflow the bottom margin and automatically adds a new page + header.
- `doc.splitTextToSize(...)`: Wraps long paragraphs to `contentWidth` so text stays inside margins.
- Loop over `totalPages`: Stamps `"Page i of totalPages"` at the bottom of every page before converting `doc.output('arraybuffer')` to a Node `Buffer` for HTTP download.
- **Important Code Note**: Section 3 (`technicalQuestions`, 10 items) and Section 4 (`behavioralQuestions`, 4 items) are currently hardcoded arrays inside `generateStudyPackPdf`, while Sections 1, 2, and 5 use the user's dynamic `companyResearch` and `analysis` data.

INTERVIEW QUESTION:
Why generate the PDF on the backend (`server/pdf.ts`) instead of on the frontend?

ANSWER:
Generating the PDF server-side via `jsPDF` guarantees consistent A4 layout across devices, keeps the study pack generation logic close to the persisted SQLite `study_packs` payload, and lets `/api/study-packs/:id/download` stream a binary `application/pdf` attachment directly.

PRACTICAL EXAMPLE:
Clicking "Download Full PDF" calls `GET /api/study-packs/:id/download`, which parses `content_json` from SQLite, passes it to `generateStudyPackPdf()`, and sets `Content-Disposition: attachment` so the browser downloads the `.pdf` file.

---

## 8. Automated Backend Tests — `server/logic.test.ts`

FILE: `server/logic.test.ts`

PURPOSE:
Runs 4 unit/integration tests using Node.js's built-in `node:test` and `node:assert/strict` modules (`npm test`).

IMPORTANT CODE:

```typescript
test('session creation, retrieval, and revocation work securely', () => {
  initDatabase();
  const user = db.prepare('SELECT id FROM app_users WHERE email = ?').get('raghav@example.com') as any;
  assert.ok(user);

  const token = createSession(user.id);
  assert.ok(typeof token === 'string' && token.length > 20);

  const retrieved = getUserFromToken(token);
  assert.ok(retrieved);
  assert.equal(retrieved.id, user.id);

  revokeSession(token);
  const afterRevoke = getUserFromToken(token);
  assert.equal(afterRevoke, null, 'Revoked token must yield null');
});
```

LINE-BY-LINE EXPLANATION:
- Tests 4 core backend flows: (1) DB schema + demo user seed, (2) token lifecycle (`createSession` -> `getUserFromToken` -> `revokeSession`), (3) `researchCompany` citations and `isVerifiedHistoricalQuestion === false`, and (4) `generateStudyPackPdf` returning a valid `%PDF-` Buffer.
- **Limitation**: There are currently no automated tests for `routes.ts` HTTP endpoints, `ai.ts` prompt parsing, or React frontend components.

---

## 9. Frontend Root & Routing — `src/App.tsx`

FILE: `src/App.tsx`

PURPOSE:
Top-level React component managing authenticated user state, initial session verification on page load, tab-based navigation (`landing`, `dashboard`, `analysis`, `interview`, `coach`, `company`, `studypacks`, `history`, `settings`), and `AuthModal` visibility.

COMMUNICATES WITH:
- `src/api.ts` (`api.getMe()`, `api.logout()`, `getStoredToken()`)
- All page views in `src/components/*`

IMPORTANT CODE:

```typescript
  useEffect(() => {
    async function checkAuth() {
      const token = getStoredToken();
      if (token) {
        try {
          const res = await api.getMe();
          setUser(res.user);
          setActiveTab('dashboard');
        } catch (e) {
          setUser(null);
          setActiveTab('landing');
        }
      } else {
        setActiveTab('landing');
      }
      setInitializing(false);
    }
    checkAuth();
  }, []);
```

LINE-BY-LINE EXPLANATION:
- On app boot (`useEffect` with `[]`), checks `localStorage` for `personal_ai_coach_token`. If found, calls `GET /api/me` to verify the session is still alive in the backend `sessions` Map; if valid, shows `dashboard`; if expired (`401`), resets to `landing`.
- Uses React state (`activeTab` + `navigationState`) rather than `react-router-dom`.
- **Bug Identified in Code**: `AnalysisView` calls `onStartInterview('technical', activeAnalysisId)` which sets `navigationState = { track, analysisId }`. However, `App.tsx` renders `<InterviewView user={user} initialTrack={navigationState?.track || 'technical'} initialSessionId={navigationState?.sessionId} ... />` without passing `analysisId`, and `InterviewView` never sends `analysisId` to `api.startInterview`.

INTERVIEW QUESTION:
How does your app know if a user is still logged in when they refresh the browser?

ANSWER:
`App.tsx` runs a `useEffect` on mount that reads the token from `localStorage` (`getStoredToken()`) and calls `GET /api/me`. If the backend finds the token in its `sessions` Map, it returns the user profile and `App.tsx` renders the dashboard; otherwise, it clears the token and shows the landing page.

---

## 10. Frontend API & Streaming Client — `src/api.ts`

FILE: `src/api.ts`

PURPOSE:
Centralizes all HTTP `fetch` calls from React to the Express `/api/*` backend, automatically attaching the `Authorization: Bearer <token>` header, clearing the token on `401`, and reading SSE streams via `ReadableStream` + `TextDecoder`.

IMPORTANT CODE:

```typescript
async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Set json content type if body is not FormData
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(endpoint, { ...options, headers });

  if (response.status === 401) {
    setStoredToken(null);
  }
  ...
```

And the SSE stream reader inside `streamCoachMessage`:

```typescript
const reader = response.body.getReader();
const decoder = new TextDecoder('utf-8');
let buffer = '';
let accumulated = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const events = buffer.split('\n\n');
  buffer = events.pop() || '';
  ...
```

LINE-BY-LINE EXPLANATION:
- `!(options.body instanceof FormData)`: Crucial detail! When uploading a resume file via `FormData`, we must NOT manually set `Content-Type: application/json`—the browser automatically sets `multipart/form-data; boundary=...`.
- `streamCoachMessage`: Why didn't the app use browser `EventSource`? Because `EventSource` only supports `GET` requests and cannot send custom `Authorization: Bearer` headers or a JSON `POST` body. So `src/api.ts` uses `fetch` + `response.body.getReader()` + `TextDecoder` and splits incoming text on `\n\n` (keeping incomplete trailing chunks in `buffer`).

---

## 11. Shared TypeScript Interfaces — `src/types.ts`

FILE: `src/types.ts`

PURPOSE:
Defines strict TypeScript interfaces (`User`, `DocumentRecord`, `AnalysisData`, `FeedbackScores`, `FeedbackData`, `InterviewSession`, `InterviewTurn`, `CoachMessage`, `CompanyResearch`, `StudyPackRecord`) shared across all React components and `src/api.ts` so field names and types stay consistent with backend JSON responses.

---

## 12. Resume & JD Analysis UI — `src/components/AnalysisView.tsx`

FILE: `src/components/AnalysisView.tsx`

PURPOSE:
Lets users upload PDF/DOCX/TXT files or paste text for their resume and target job description, edit extracted text inline, run the 4-stage analysis (`POST /api/analysis`), and view their match score, requirement-by-requirement resume quotes, strengths, gaps, truthful keywords, likely topics, and 7-day study plan.

IMPORTANT CODE:

```typescript
  const handleRunAnalysis = async () => {
    setError(null);
    let rId = resumeDocId;
    let jId = jdDocId;

    try {
      setAnalyzing(true);
      setAnalysisStep(1);

      if (!rId) {
        if (!resumeText.trim()) throw new Error('Please upload or paste your resume text.');
        const rRes = await api.uploadResume({ text: resumeText });
        rId = rRes.documentId;
        setResumeDocId(rId);
      }
      setAnalysisStep(2);

      if (!jId) {
        if (!jdText.trim()) throw new Error('Please upload or paste the job description.');
        const jRes = await api.uploadJd({ text: jdText });
        jId = jRes.documentId;
        setJdDocId(jId);
      }
      setAnalysisStep(3);

      const res = await api.runAnalysis({
        resumeDocumentId: rId,
        jdDocumentId: jId,
        targetRole,
        targetCompany,
      });
      ...
```

LINE-BY-LINE EXPLANATION:
- Tracks 4 UI progress stages (`analysisStep` 1→4) during upload and analysis.
- **Bug Identified in Code**: If a user uploads a file first (`rId` is set) and then clicks "Edit Text" to modify `resumeText`, `handleRunAnalysis` sees `rId` is already truthy and never calls `api.updateDocText(rId, resumeText)`—so the backend analyzes the pre-edit uploaded text instead of the edited text!

---

## 13. Mock Interview Arena UI — `src/components/InterviewView.tsx`

FILE: `src/components/InterviewView.tsx`

PURPOSE:
Runs the 3 mock interview tracks (`hr`, `technical`, `project_mixed`) with a 20-minute countdown timer (`1200` seconds), pause/resume button, browser SpeechRecognition (voice input) and SpeechSynthesis (question read-aloud), answer submission, immediate 8-dimension rubric scorecard display, and final session report.

IMPORTANT CODE:

```typescript
  // Timer effect
  useEffect(() => {
    if (!activeSession || isPaused || finalReport) return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleEndInterview();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSession, isPaused, finalReport]);
```

LINE-BY-LINE EXPLANATION:
- `secondsRemaining` counts down every second via `setInterval` whenever `activeSession` is active and not paused/completed; when reaching `0`, calls `handleEndInterview()`.
- Uses browser `window.SpeechRecognition || window.webkitSpeechRecognition` for speech-to-text and `window.speechSynthesis` for read-aloud—zero external paid speech API needed.
- **Bugs/Gaps Noted**: Pausing sets client `isPaused`, but does not notify the backend to increment `paused_seconds` in SQLite; also `recog.onresult` with `interimResults = true` appends intermediate results repeatedly into `answerText`.

---

## 14. Ask Me AI Coach Chat UI — `src/components/CoachView.tsx`

FILE: `src/components/CoachView.tsx`

PURPOSE:
Provides a ChatGPT-style real-time streaming chat interface grounded in the user's resume, JD, and past interview reports, with a thinking indicator, token-by-token streaming bubble, "Stop" abort button (`AbortController`), smart auto-scroll that respects manual scrolling (`userScrolledUpRef`), copy button, grounding citation pills, suggested follow-up chips, and voice input.

---

## 15. Custom Streaming Markdown Renderer — `src/components/MarkdownContent.tsx`

FILE: `src/components/MarkdownContent.tsx`

PURPOSE:
Parses AI-generated Markdown text (headers, bullet lists, numbered lists, blockquotes, fenced code blocks with copy buttons, inline code, and `**bold**` text) into styled React elements without external libraries. Automatically strips trailing `CITATIONS:` / `FOLLOW_UPS:` metadata blocks during live streaming and handles unclosed ```` ``` ```` code fences cleanly mid-stream.

---

## 16. Other UI Views

- **`src/components/Navbar.tsx`**: Sticky top header with 7 navigation tabs, mobile horizontal nav bar, user avatar/target badge, and sign-out button.
- **`src/components/LandingView.tsx`**: Unauthenticated home page featuring hero CTA, 1-click demo login trigger, 3 feature pillar cards, and ethical AI transparency disclosure.
- **`src/components/AuthModal.tsx`**: Modal supporting Sign In, Register, show/hide password toggle, and 1-click Demo Login (`raghav@example.com` / `Password123!`).
- **`src/components/DashboardView.tsx`**: Time-aware greeting, readiness gauge SVG, 4 module launch cards, recent sessions list, and quick CTAs for Study Packs & Ask Me Coach.
- **`src/components/CompanyResearchView.tsx`**: Search bar, 5 quick-pick chips (`Stripe`, `Google`, `Amazon`, `Meta`, `Netflix`), overview card, sourced citation cards with external links, tech tags, and practice questions with disclaimer.
- **`src/components/StudyPacksView.tsx`**: Generates study packs (`POST /api/study-packs`), displays multi-section preview, downloads server-generated PDFs via Blob URL, and deletes study packs.
- **`src/components/HistoryView.tsx`**: Lists all sessions and displays turn-by-turn questions, candidate answers, rubric scores, and improved answers.
- **`src/components/SettingsView.tsx`**: Updates profile (`PATCH /api/me`), exports user data as a client-side JSON file, and supports permanent account deletion (`DELETE /api/me`).

---

## 17. Configuration & Deployment Files

- **`package.json`**: Declares `"type": "module"`, scripts (`dev`, `start`, `build`, `lint` running `tsc --noEmit`, `test` running `tsx --test server/*.test.ts`), and all runtime/dev dependencies.
- **`vite.config.ts`**: Configures React plugin, Tailwind v4 Vite plugin, `@` alias, `host: '0.0.0.0'`, `port: 3000`, `allowedHosts: true as const`, and `DISABLE_HMR` handling.
- **`Dockerfile`**: Multi-stage Alpine Linux Node 22 build (`npm ci` + `npm run build` in builder; production dependencies + `tsx` + `dist/` + `server/` in runner on port `10000`).
- **`render.yaml`**: Render Blueprint deploying a Node web service with `buildCommand: npm install && npm run build`, `startCommand: npm start`, `healthCheckPath: /api/health`, and `GEMINI_API_KEY` / `GEMINI_MODEL` env vars.
