import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { authenticate, createSession, revokeSession, revokeUserSessions, logAuditEvent } from './auth.js';
import {
  analyzeResumeAndJd,
  generateQuestion,
  evaluateAnswer,
  coachChat,
  coachChatStream,
} from './ai.js';
import {
  extractTextFromBuffer,
  DocumentValidationError,
  sanitizeFilename,
  MAX_UPLOAD_SIZE_BYTES,
} from './documents.js';
import {
  extractTechnologies,
  extractResumeProjects,
  COMMON_TECH_OPTIONS,
} from './resumeParser.js';
import { researchCompany } from './search.js';
import { generateStudyPackPdf } from './pdf.js';

export const apiRouter = Router();

// File upload configuration: max 10MB in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    const lowerName = (file.originalname || '').toLowerCase();
    if (lowerName.endsWith('.doc') || file.mimetype === 'application/msword') {
      return cb(
        new DocumentValidationError(
          'Legacy binary .doc format is not supported. Please upload a .pdf, .docx, or .txt file.',
          400,
          'UNSUPPORTED_FORMAT'
        )
      );
    }
    if (allowedMimes.includes(file.mimetype) || /\.(pdf|docx|txt)$/i.test(lowerName)) {
      cb(null, true);
    } else {
      cb(
        new DocumentValidationError(
          'Unsupported file format. Please upload a PDF (.pdf), Word (.docx), or plain text (.txt) file.',
          400,
          'UNSUPPORTED_FORMAT'
        )
      );
    }
  },
});

function handleSingleFileUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: any) => {
    if (!err) return next();
    if (err instanceof DocumentValidationError) {
      return res.status(err.status).json({
        error: { code: err.code, message: err.message },
      });
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the 10MB maximum size limit.' },
        });
      }
      return res.status(400).json({
        error: { code: 'UPLOAD_ERROR', message: err.message || 'File upload failed.' },
      });
    }
    return res.status(400).json({
      error: { code: 'UPLOAD_ERROR', message: err.message || 'Invalid file upload.' },
    });
  });
}

function safeDbJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getLatestUserDocuments(userId: string) {
  const resume = db
    .prepare(
      "SELECT id, original_filename, mime_type, size_bytes, extracted_text, created_at FROM documents WHERE user_id = ? AND document_type = 'resume' ORDER BY created_at DESC LIMIT 1"
    )
    .get(userId) as any;
  const jd = db
    .prepare(
      "SELECT id, original_filename, mime_type, size_bytes, extracted_text, created_at FROM documents WHERE user_id = ? AND document_type = 'jd' ORDER BY created_at DESC LIMIT 1"
    )
    .get(userId) as any;
  return { resume: resume || null, jd: jd || null };
}

/* ==========================================================================
   SYSTEM / HEALTH
   ========================================================================== */
apiRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

apiRouter.get('/readiness', (req: Request, res: Response) => {
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5);
  res.json({
    status: 'ready',
    database: 'connected (node:sqlite)',
    aiConfigured: hasGeminiKey,
    aiProvider: hasGeminiKey ? 'Gemini AI (Active)' : 'Rule-Based Resume-Aware Fallback Engine (GEMINI_API_KEY not set)',
    searchAdapter: 'DuckDuckGo + Verified Knowledge Base',
    storage: 'Local persistent database',
  });
});

/* ==========================================================================
   AUTH
   ========================================================================== */
apiRouter.post('/auth/register', async (req: Request, res: Response) => {
  const { name, email, password, target_role, target_company, experience_level } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Name must be at least 2 characters.' } });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email)) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'A valid email address is required.' } });
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters long.' } });
  }

  const cleanEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM app_users WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: { code: 'USER_EXISTS', message: 'An account with this email already exists.' } });
  }

  const userId = crypto.randomUUID();
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  db.prepare(`
    INSERT INTO app_users (id, name, email, password_hash, target_role, target_company, experience_level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    name.trim(),
    cleanEmail,
    passwordHash,
    typeof target_role === 'string' && target_role.trim() ? target_role.trim() : null,
    typeof target_company === 'string' && target_company.trim() ? target_company.trim() : null,
    typeof experience_level === 'string' && experience_level.trim() ? experience_level.trim() : null
  );

  const token = createSession(userId);
  logAuditEvent(userId, 'USER_REGISTERED', { email: cleanEmail });

  res.status(201).json({
    user: {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      preferred_language: 'en',
      target_role: typeof target_role === 'string' && target_role.trim() ? target_role.trim() : null,
      target_company: typeof target_company === 'string' && target_company.trim() ? target_company.trim() : null,
      experience_level: typeof experience_level === 'string' && experience_level.trim() ? experience_level.trim() : null,
    },
    token,
  });
});

apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body || {};

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Email and password are required.' } });
  }

  const cleanEmail = email.toLowerCase().trim();
  const userRow = db.prepare(`
    SELECT id, name, email, password_hash, preferred_language, target_role, target_company, experience_level
    FROM app_users WHERE email = ?
  `).get(cleanEmail) as any;

  if (!userRow || !bcrypt.compareSync(password, userRow.password_hash)) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
  }

  const token = createSession(userRow.id);
  logAuditEvent(userRow.id, 'USER_LOGIN', { email: cleanEmail });

  res.json({
    user: {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      preferred_language: userRow.preferred_language,
      target_role: userRow.target_role,
      target_company: userRow.target_company,
      experience_level: userRow.experience_level,
    },
    token,
  });
});

apiRouter.post('/auth/logout', authenticate, (req: Request, res: Response) => {
  const token = (req as any).token;
  if (token) revokeSession(token);
  logAuditEvent((req as any).user.id, 'USER_LOGOUT');
  res.json({ success: true, message: 'Logged out successfully.' });
});

apiRouter.post('/auth/password-reset/request', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'If an account exists with this email, password reset instructions have been dispatched.',
  });
});

apiRouter.get('/me', authenticate, (req: Request, res: Response) => {
  res.json({ user: (req as any).user });
});

apiRouter.patch('/me', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, target_role, target_company, experience_level, preferred_language } = req.body || {};

  const updates: string[] = [];
  const params: any[] = [];

  if (name && typeof name === 'string' && name.trim().length >= 2) {
    updates.push('name = ?');
    params.push(name.trim());
  }
  if (target_role !== undefined) {
    updates.push('target_role = ?');
    params.push(typeof target_role === 'string' && target_role.trim() ? target_role.trim() : null);
  }
  if (target_company !== undefined) {
    updates.push('target_company = ?');
    params.push(typeof target_company === 'string' && target_company.trim() ? target_company.trim() : null);
  }
  if (experience_level !== undefined) {
    updates.push('experience_level = ?');
    params.push(typeof experience_level === 'string' && experience_level.trim() ? experience_level.trim() : null);
  }
  if (preferred_language !== undefined) {
    updates.push('preferred_language = ?');
    params.push(typeof preferred_language === 'string' && preferred_language.trim() ? preferred_language.trim() : 'en');
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    params.push(userId);
    db.prepare(`UPDATE app_users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updatedUser = db.prepare(`
    SELECT id, name, email, preferred_language, target_role, target_company, experience_level
    FROM app_users WHERE id = ?
  `).get(userId);

  res.json({ user: updatedUser });
});

apiRouter.delete('/me', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  logAuditEvent(userId, 'ACCOUNT_DELETED');
  db.prepare('DELETE FROM app_users WHERE id = ?').run(userId);
  revokeUserSessions(userId);
  res.json({ success: true, message: 'Account and associated data deleted permanently.' });
});

/* ==========================================================================
   DOCUMENTS (Resume & Job Description)
   ========================================================================== */
apiRouter.get('/documents/latest', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { resume, jd } = getLatestUserDocuments(userId);
  const detectedTechnologies = extractTechnologies(resume?.extracted_text || '', jd?.extracted_text || '');
  const detectedProjects = extractResumeProjects(resume?.extracted_text || '');

  res.json({
    resume: resume
      ? {
          id: resume.id,
          filename: resume.original_filename,
          mimeType: resume.mime_type,
          sizeBytes: resume.size_bytes,
          extractedText: resume.extracted_text || '',
          createdAt: resume.created_at,
        }
      : null,
    jd: jd
      ? {
          id: jd.id,
          filename: jd.original_filename,
          mimeType: jd.mime_type,
          sizeBytes: jd.size_bytes,
          extractedText: jd.extracted_text || '',
          createdAt: jd.created_at,
        }
      : null,
    detectedTechnologies,
    detectedProjects,
  });
});

apiRouter.post('/documents/resume', authenticate, handleSingleFileUpload, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  let text = '';
  let filename = 'pasted_resume.txt';
  let mimeType = 'text/plain';
  let sizeBytes = 0;

  try {
    if (req.file) {
      filename = sanitizeFilename(req.file.originalname);
      mimeType = req.file.mimetype;
      sizeBytes = req.file.size;
      text = await extractTextFromBuffer(req.file.buffer, mimeType, filename);
    } else if (typeof req.body?.text === 'string') {
      text = req.body.text.replace(/\r\n/g, '\n').trim();
      if (text.length < 10) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Resume text is empty or too short (minimum 10 characters).' },
        });
      }
      sizeBytes = Buffer.byteLength(text, 'utf-8');
    } else {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Please upload a resume file (.pdf, .docx, .txt) or paste text.' },
      });
    }
  } catch (err: any) {
    if (err instanceof DocumentValidationError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    return res.status(422).json({
      error: { code: 'EXTRACTION_FAILED', message: err.message || 'Failed to process resume document.' },
    });
  }

  const docId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO documents (id, user_id, document_type, original_filename, mime_type, size_bytes, extracted_text, extraction_status)
    VALUES (?, ?, 'resume', ?, ?, ?, ?, 'completed')
  `).run(docId, userId, filename, mimeType, sizeBytes, text);

  logAuditEvent(userId, 'DOCUMENT_UPLOADED', { documentId: docId, type: 'resume', sizeBytes });

  res.status(201).json({
    documentId: docId,
    status: 'completed',
    filename,
    sizeBytes,
    extractedTextPreview: text.slice(0, 500),
    extractedText: text,
    detectedTechnologies: extractTechnologies(text, ''),
    detectedProjects: extractResumeProjects(text),
  });
});

apiRouter.post('/documents/jd', authenticate, handleSingleFileUpload, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  let text = '';
  let filename = 'pasted_job_description.txt';
  let mimeType = 'text/plain';
  let sizeBytes = 0;

  try {
    if (req.file) {
      filename = sanitizeFilename(req.file.originalname);
      mimeType = req.file.mimetype;
      sizeBytes = req.file.size;
      text = await extractTextFromBuffer(req.file.buffer, mimeType, filename);
    } else if (typeof req.body?.text === 'string') {
      text = req.body.text.replace(/\r\n/g, '\n').trim();
      if (text.length < 10) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Job description text is empty or too short (minimum 10 characters).' },
        });
      }
      sizeBytes = Buffer.byteLength(text, 'utf-8');
    } else {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Please provide job description text or upload a file (.pdf, .docx, .txt).' },
      });
    }
  } catch (err: any) {
    if (err instanceof DocumentValidationError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    return res.status(422).json({
      error: { code: 'EXTRACTION_FAILED', message: err.message || 'Failed to process job description document.' },
    });
  }

  const docId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO documents (id, user_id, document_type, original_filename, mime_type, size_bytes, extracted_text, extraction_status)
    VALUES (?, ?, 'jd', ?, ?, ?, ?, 'completed')
  `).run(docId, userId, filename, mimeType, sizeBytes, text);

  logAuditEvent(userId, 'DOCUMENT_UPLOADED', { documentId: docId, type: 'jd', sizeBytes });

  res.status(201).json({
    documentId: docId,
    status: 'completed',
    filename,
    sizeBytes,
    extractedTextPreview: text.slice(0, 500),
    extractedText: text,
    detectedTechnologies: extractTechnologies('', text),
  });
});

apiRouter.patch('/documents/:id/text', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const docId = req.params.id;
  const { extractedText } = req.body || {};

  if (typeof extractedText !== 'string' || extractedText.trim().length < 10) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'extractedText must be a non-empty string (at least 10 characters).' },
    });
  }

  const cleanText = extractedText.trim();
  const result = db.prepare(`
    UPDATE documents SET extracted_text = ?, size_bytes = ? WHERE id = ? AND user_id = ?
  `).run(cleanText, Buffer.byteLength(cleanText, 'utf-8'), docId, userId);

  if (result.changes === 0) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found or unauthorized.' } });
  }

  res.json({
    success: true,
    message: 'Document text updated successfully.',
    detectedTechnologies: extractTechnologies(cleanText, ''),
    detectedProjects: extractResumeProjects(cleanText),
  });
});

apiRouter.get('/documents/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const doc = db.prepare(`
    SELECT id, document_type, original_filename, mime_type, size_bytes, extracted_text, extraction_status, created_at
    FROM documents WHERE id = ? AND user_id = ?
  `).get(req.params.id, userId);

  if (!doc) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
  }

  res.json({ document: doc });
});

/* ==========================================================================
   ANALYSIS & RESEARCH
   ========================================================================== */
apiRouter.post('/analysis', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { resumeDocumentId, jdDocumentId, targetRole, targetCompany } = req.body || {};

    const resumeDoc = db.prepare("SELECT id, extracted_text FROM documents WHERE id = ? AND user_id = ? AND document_type = 'resume'").get(resumeDocumentId, userId) as any;
    const jdDoc = db.prepare("SELECT id, extracted_text FROM documents WHERE id = ? AND user_id = ? AND document_type = 'jd'").get(jdDocumentId, userId) as any;

    if (!resumeDoc || !jdDoc) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Valid resume and job description documents are required.' } });
    }

    const role = (typeof targetRole === 'string' && targetRole.trim()) || (req as any).user.target_role || 'Software Engineer';
    const company = (typeof targetCompany === 'string' && targetCompany.trim()) || (req as any).user.target_company || 'Tech Company';

    const analysisResult = await analyzeResumeAndJd(
      resumeDoc.extracted_text,
      jdDoc.extracted_text,
      role,
      company
    );

    const analysisId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO analyses (id, user_id, resume_document_id, jd_document_id, target_role, target_company, result_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')
    `).run(
      analysisId,
      userId,
      resumeDocumentId,
      jdDocumentId,
      role,
      company,
      JSON.stringify(analysisResult)
    );

    logAuditEvent(userId, 'ANALYSIS_COMPLETED', { analysisId, targetRole: role, targetCompany: company });

    res.status(201).json({
      analysisId,
      status: 'completed',
      result: analysisResult,
    });
  } catch (err: any) {
    console.error('Error in POST /api/analysis:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message || 'Analysis failed.' } });
  }
});

apiRouter.get('/analysis/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const row = db.prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?').get(req.params.id, userId) as any;

  if (!row) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Analysis not found.' } });
  }

  res.json({
    analysis: {
      id: row.id,
      resumeDocumentId: row.resume_document_id,
      jdDocumentId: row.jd_document_id,
      targetRole: row.target_role,
      targetCompany: row.target_company,
      status: row.status,
      createdAt: row.created_at,
      result: safeDbJsonParse(row.result_json, {}),
    },
  });
});

apiRouter.get('/analyses', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const rows = db.prepare('SELECT id, target_role, target_company, status, created_at FROM analyses WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  res.json({ analyses: rows });
});

apiRouter.post('/company-research', authenticate, async (req: Request, res: Response) => {
  try {
    const { company, role } = req.body || {};
    if (!company || typeof company !== 'string' || !company.trim()) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Company name is required.' } });
    }

    const result = await researchCompany(company.trim(), (typeof role === 'string' && role.trim()) || 'Software Engineer');
    res.json({ research: result });
  } catch (err: any) {
    console.error('Error in POST /api/company-research:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message || 'Company research failed.' } });
  }
});

/* ==========================================================================
   MOCK INTERVIEWS (Tracks 1, 2, 3)
   ========================================================================== */
apiRouter.get('/interviews/context', authenticate, (req: Request, res: Response) => {
  const user = (req as any).user;
  const { resume, jd } = getLatestUserDocuments(user.id);
  const latestAnalysis = db
    .prepare('SELECT id, target_role, target_company, created_at FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(user.id) as any;

  const resumeText = resume?.extracted_text || '';
  const jdText = jd?.extracted_text || '';
  const detectedTechnologies = extractTechnologies(resumeText, jdText);
  const detectedProjects = extractResumeProjects(resumeText);

  res.json({
    resumeLoaded: Boolean(resume),
    resumeFilename: resume?.original_filename || null,
    resumeCharCount: resumeText.length,
    jdLoaded: Boolean(jd),
    jdFilename: jd?.original_filename || null,
    jdCharCount: jdText.length,
    latestAnalysisId: latestAnalysis?.id || null,
    targetRole: latestAnalysis?.target_role || user.target_role || 'Software Engineer',
    targetCompany: latestAnalysis?.target_company || user.target_company || 'Tech Company',
    detectedTechnologies,
    availableTechOptions: Array.from(new Set([...detectedTechnologies, ...COMMON_TECH_OPTIONS])),
    detectedProjects,
    aiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5),
  });
});

apiRouter.post('/interviews', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const {
      analysisId,
      type,
      targetDurationMinutes = 20,
      mode = 'text',
      focusTechnologies = [],
      selectedProject,
    } = req.body || {};

    const validTypes = ['hr', 'technical', 'project_mixed'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid interview type. Must be hr, technical, or project_mixed.' } });
    }

    const safeMode = mode === 'voice' ? 'voice' : 'text';
    const numericMins = Number(targetDurationMinutes);
    const safeMinutes = Number.isFinite(numericMins) ? Math.min(120, Math.max(1, Math.round(numericMins))) : 20;

    const cleanFocusTechs = Array.isArray(focusTechnologies)
      ? focusTechnologies.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 10)
      : [];
    const cleanSelectedProject = typeof selectedProject === 'string' && selectedProject.trim() ? selectedProject.trim() : undefined;

    let resolvedAnalysisId: string | null = null;
    let resumeText = '';
    let jdText = '';
    let resumeFilename: string | null = null;
    let jdFilename: string | null = null;
    let targetRole = (req as any).user.target_role || 'Software Engineer';
    let targetCompany = (req as any).user.target_company || 'Tech Company';

    if (analysisId) {
      const analysisRow = db.prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?').get(analysisId, userId) as any;
      if (analysisRow) {
        resolvedAnalysisId = analysisRow.id;
        targetRole = analysisRow.target_role || targetRole;
        targetCompany = analysisRow.target_company || targetCompany;
        if (analysisRow.resume_document_id) {
          const rDoc = db.prepare('SELECT original_filename, extracted_text FROM documents WHERE id = ? AND user_id = ?').get(analysisRow.resume_document_id, userId) as any;
          if (rDoc) {
            resumeText = rDoc.extracted_text || '';
            resumeFilename = rDoc.original_filename;
          }
        }
        if (analysisRow.jd_document_id) {
          const jDoc = db.prepare('SELECT original_filename, extracted_text FROM documents WHERE id = ? AND user_id = ?').get(analysisRow.jd_document_id, userId) as any;
          if (jDoc) {
            jdText = jDoc.extracted_text || '';
            jdFilename = jDoc.original_filename;
          }
        }
      }
    }

    // Always fall back to latest uploaded user documents if no analysisId or missing linked doc
    if (!resumeText || !jdText) {
      const latest = getLatestUserDocuments(userId);
      if (!resumeText && latest.resume) {
        resumeText = latest.resume.extracted_text || '';
        resumeFilename = latest.resume.original_filename;
      }
      if (!jdText && latest.jd) {
        jdText = latest.jd.extracted_text || '';
        jdFilename = latest.jd.original_filename;
      }
    }

    const sessionId = crypto.randomUUID();
    const targetDurationSeconds = safeMinutes * 60;
    const now = new Date().toISOString();
    const sessionMetadata = {
      focusTechnologies: cleanFocusTechs,
      selectedProject: cleanSelectedProject || null,
      targetRole,
      targetCompany,
    };

    db.prepare(`
      INSERT INTO interview_sessions (
        id, user_id, analysis_id, session_type, mode, status,
        target_duration_seconds, started_at, duration_seconds, ended_early, metadata_json
      ) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, 0, 0, ?)
    `).run(
      sessionId,
      userId,
      resolvedAnalysisId,
      type,
      safeMode,
      targetDurationSeconds,
      now,
      JSON.stringify(sessionMetadata)
    );

    // Generate question 1
    const firstQuestion = await generateQuestion({
      sessionType: type,
      targetRole,
      targetCompany,
      resumeText,
      jdText,
      sequenceNo: 1,
      previousTurns: [],
      focusTechnologies: cleanFocusTechs,
      selectedProject: cleanSelectedProject,
    });

    const turnId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO interview_turns (id, session_id, sequence_no, question_text, question_category, question_metadata, asked_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `).run(
      turnId,
      sessionId,
      firstQuestion.questionText,
      firstQuestion.category,
      JSON.stringify(firstQuestion),
      now
    );

    logAuditEvent(userId, 'INTERVIEW_STARTED', { sessionId, type, mode: safeMode });

    res.status(201).json({
      sessionId,
      status: 'in_progress',
      type,
      targetDurationSeconds,
      contextSummary: {
        resumeLoaded: Boolean(resumeText),
        resumeFilename,
        jdLoaded: Boolean(jdText),
        jdFilename,
        detectedTechnologies: extractTechnologies(resumeText, jdText),
        detectedProjects: extractResumeProjects(resumeText),
      },
      currentTurn: {
        turnId,
        sequenceNo: 1,
        question: firstQuestion.questionText,
        category: firstQuestion.category,
        rationale: firstQuestion.rationale,
        difficulty: firstQuestion.difficulty,
        generationMode: firstQuestion.generationMode,
        aiNotice: firstQuestion.aiNotice,
      },
    });
  } catch (err: any) {
    console.error('Error in POST /api/interviews:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to start interview session.' } });
  }
});

apiRouter.get('/interviews/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const session = db.prepare('SELECT * FROM interview_sessions WHERE id = ? AND user_id = ?').get(req.params.id, userId) as any;

  if (!session) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Interview session not found.' } });
  }

  const turns = db.prepare('SELECT * FROM interview_turns WHERE session_id = ? ORDER BY sequence_no ASC').all(session.id) as any[];

  res.json({
    session: {
      ...session,
      metadata: safeDbJsonParse(session.metadata_json, {}),
      finalReport: session.final_report_json ? safeDbJsonParse(session.final_report_json, null) : null,
    },
    turns: turns.map(t => {
      const qMeta = safeDbJsonParse<any>(t.question_metadata, {});
      return {
        id: t.id,
        sequenceNo: t.sequence_no,
        questionText: t.question_text,
        questionCategory: t.question_category,
        rationale: qMeta.rationale || undefined,
        difficulty: qMeta.difficulty || undefined,
        generationMode: qMeta.generationMode || undefined,
        aiNotice: qMeta.aiNotice || undefined,
        answerText: t.answer_text,
        transcriptEdited: Boolean(t.transcript_edited),
        feedback: t.feedback_json ? safeDbJsonParse(t.feedback_json, null) : null,
        askedAt: t.asked_at,
        answeredAt: t.answered_at,
      };
    }),
  });
});

apiRouter.post('/interviews/:id/answer', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const sessionId = req.params.id;
    const { turnId, answerText, transcriptEdited = false } = req.body || {};

    if (!answerText || typeof answerText !== 'string' || answerText.trim().length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please provide an answer before submitting.' } });
    }

    const session = db.prepare('SELECT * FROM interview_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId) as any;
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Interview session not found.' } });
    }

    if (session.status === 'completed') {
      return res.status(400).json({ error: { code: 'SESSION_COMPLETED', message: 'This interview session has already ended.' } });
    }

    const turn = db.prepare('SELECT * FROM interview_turns WHERE id = ? AND session_id = ?').get(turnId, sessionId) as any;
    if (!turn) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Interview turn not found.' } });
    }

    const sessionMeta = safeDbJsonParse<any>(session.metadata_json, {});
    let resumeText = '';
    let jdText = '';
    let targetRole = sessionMeta.targetRole || (req as any).user.target_role || 'Software Engineer';
    let targetCompany = sessionMeta.targetCompany || (req as any).user.target_company || 'Tech Company';

    if (session.analysis_id) {
      const analysisRow = db.prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?').get(session.analysis_id, userId) as any;
      if (analysisRow) {
        targetRole = analysisRow.target_role || targetRole;
        targetCompany = analysisRow.target_company || targetCompany;
        if (analysisRow.resume_document_id) {
          const rDoc = db.prepare('SELECT extracted_text FROM documents WHERE id = ? AND user_id = ?').get(analysisRow.resume_document_id, userId) as any;
          if (rDoc) resumeText = rDoc.extracted_text || '';
        }
        if (analysisRow.jd_document_id) {
          const jDoc = db.prepare('SELECT extracted_text FROM documents WHERE id = ? AND user_id = ?').get(analysisRow.jd_document_id, userId) as any;
          if (jDoc) jdText = jDoc.extracted_text || '';
        }
      }
    }

    if (!resumeText || !jdText) {
      const latest = getLatestUserDocuments(userId);
      if (!resumeText && latest.resume) resumeText = latest.resume.extracted_text || '';
      if (!jdText && latest.jd) jdText = latest.jd.extracted_text || '';
    }

    // 1. Evaluate answer using 8-dimension rubric
    const feedback = await evaluateAnswer({
      question: turn.question_text,
      questionCategory: turn.question_category,
      answer: answerText.trim(),
      resumeText,
      jdText,
    });

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE interview_turns
      SET answer_text = ?, transcript_edited = ?, feedback_json = ?, answered_at = ?
      WHERE id = ?
    `).run(
      answerText.trim(),
      transcriptEdited ? 1 : 0,
      JSON.stringify(feedback),
      now,
      turnId
    );

    // Check all answered turns for follow-up context
    const turns = db.prepare('SELECT * FROM interview_turns WHERE session_id = ? ORDER BY sequence_no ASC').all(sessionId) as any[];
    const nextSeq = turns.length + 1;

    const previousTurns = turns.map(t => ({
      question: t.question_text,
      answer: t.answer_text || '',
    }));

    const nextQuestion = await generateQuestion({
      sessionType: session.session_type,
      targetRole,
      targetCompany,
      resumeText,
      jdText,
      sequenceNo: nextSeq,
      previousTurns,
      focusTechnologies: Array.isArray(sessionMeta.focusTechnologies) ? sessionMeta.focusTechnologies : [],
      selectedProject: sessionMeta.selectedProject || undefined,
    });

    const nextTurnId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO interview_turns (id, session_id, sequence_no, question_text, question_category, question_metadata, asked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      nextTurnId,
      sessionId,
      nextSeq,
      nextQuestion.questionText,
      nextQuestion.category,
      JSON.stringify(nextQuestion),
      now
    );

    res.json({
      feedback,
      nextTurn: {
        turnId: nextTurnId,
        sequenceNo: nextSeq,
        question: nextQuestion.questionText,
        category: nextQuestion.category,
        rationale: nextQuestion.rationale,
        difficulty: nextQuestion.difficulty,
        generationMode: nextQuestion.generationMode,
        aiNotice: nextQuestion.aiNotice,
      },
    });
  } catch (err: any) {
    console.error('Error in POST /api/interviews/:id/answer:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to evaluate answer.' } });
  }
});

apiRouter.post('/interviews/:id/end', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const sessionId = req.params.id;
  const session = db.prepare('SELECT * FROM interview_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId) as any;

  if (!session) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Interview session not found.' } });
  }

  const turns = db.prepare('SELECT * FROM interview_turns WHERE session_id = ? AND answer_text IS NOT NULL ORDER BY sequence_no ASC').all(sessionId) as any[];

  const started = new Date(session.started_at || session.created_at).getTime();
  const now = Date.now();
  const clientPaused = Number(req.body?.pausedSeconds);
  const pausedSecs = Number.isFinite(clientPaused) && clientPaused >= 0 ? Math.floor(clientPaused) : (session.paused_seconds || 0);
  const durationSeconds = Math.max(1, Math.floor((now - started) / 1000) - pausedSecs);
  const endedEarly = durationSeconds < session.target_duration_seconds;

  // Calculate all 8 composite rubric scores
  let totalTech = 0;
  let totalRel = 0;
  let totalComp = 0;
  let totalStruct = 0;
  let totalClarity = 0;
  let totalGrammar = 0;
  let totalConcise = 0;
  let totalProject = 0;
  let count = 0;

  const collectedPracticeTasks: string[] = [];

  for (const t of turns) {
    if (t.feedback_json) {
      const fb = safeDbJsonParse<any>(t.feedback_json, null);
      if (fb?.scores) {
        totalTech += Number(fb.scores.technicalCorrectness) || 0;
        totalRel += Number(fb.scores.relevance) || 0;
        totalComp += Number(fb.scores.completeness) || 0;
        totalStruct += Number(fb.scores.structure) || 0;
        totalClarity += Number(fb.scores.communicationClarity) || 0;
        totalGrammar += Number(fb.scores.grammarVocabulary) || 0;
        totalConcise += Number(fb.scores.conciseness) || 0;
        totalProject += Number(fb.scores.projectEvidence) || 0;
        count++;
      }
      if (typeof fb?.practiceTask === 'string' && fb.practiceTask.trim()) {
        collectedPracticeTasks.push(fb.practiceTask.trim());
      }
    }
  }

  const categoryScores = count > 0 ? {
    technicalCorrectness: Number((totalTech / count).toFixed(1)),
    relevance: Number((totalRel / count).toFixed(1)),
    completeness: Number((totalComp / count).toFixed(1)),
    structure: Number((totalStruct / count).toFixed(1)),
    communicationClarity: Number((totalClarity / count).toFixed(1)),
    grammarVocabulary: Number((totalGrammar / count).toFixed(1)),
    conciseness: Number((totalConcise / count).toFixed(1)),
    projectEvidence: Number((totalProject / count).toFixed(1)),
  } : {
    technicalCorrectness: 0,
    relevance: 0,
    completeness: 0,
    structure: 0,
    communicationClarity: 0,
    grammarVocabulary: 0,
    conciseness: 0,
    projectEvidence: 0,
  };

  const avgScore = count > 0
    ? Number((
        (categoryScores.technicalCorrectness +
          categoryScores.relevance +
          categoryScores.completeness +
          categoryScores.structure +
          categoryScores.communicationClarity +
          categoryScores.grammarVocabulary +
          categoryScores.conciseness +
          categoryScores.projectEvidence) / 8
      ).toFixed(1))
    : 0;

  const defaultTasks = [
    'Refine STAR stories for behavioral and cross-functional conflict scenarios.',
    'Practice 90-second architecture summaries covering trade-offs and edge cases.',
    'Highlight quantifiable metrics and resume project evidence in every answer.',
  ];

  const practiceTasks = Array.from(new Set([...collectedPracticeTasks, ...defaultTasks])).slice(0, 3);

  const finalReport = {
    overallScore: avgScore,
    durationSeconds,
    targetDurationSeconds: session.target_duration_seconds,
    endedEarly,
    questionsAnswered: count,
    categoryScores,
    summary:
      count === 0
        ? `Session closed after ${durationSeconds}s with 0 questions answered. Start another session and submit at least one answer for a scored evaluation.`
        : endedEarly
        ? `Completed ${count} question(s) in ${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s. Session was ended before the full target timer.`
        : `Completed full mock session with ${count} questions answered and evaluated across all 8 rubric dimensions.`,
    practiceTasks,
  };

  db.prepare(`
    UPDATE interview_sessions
    SET status = 'completed', ended_at = datetime('now'), paused_seconds = ?, duration_seconds = ?, ended_early = ?, final_report_json = ?
    WHERE id = ?
  `).run(
    pausedSecs,
    durationSeconds,
    endedEarly ? 1 : 0,
    JSON.stringify(finalReport),
    sessionId
  );

  logAuditEvent(userId, 'INTERVIEW_COMPLETED', { sessionId, durationSeconds, endedEarly, overallScore: avgScore });

  res.json({
    status: 'completed',
    report: finalReport,
  });
});

apiRouter.get('/interviews', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const sessions = db.prepare(`
    SELECT id, session_type, mode, status, duration_seconds, target_duration_seconds, ended_early, started_at, ended_at, final_report_json, created_at
    FROM interview_sessions WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId) as any[];

  res.json({
    interviews: sessions.map(s => ({
      ...s,
      finalReport: s.final_report_json ? safeDbJsonParse(s.final_report_json, null) : null,
    })),
  });
});

apiRouter.delete('/interviews/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const result = db.prepare('DELETE FROM interview_sessions WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Interview session not found.' } });
  }
  res.json({ success: true, message: 'Interview session deleted.' });
});

/* ==========================================================================
   ASK ME (AI COACH)
   ========================================================================== */
apiRouter.post('/coach/chat', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { conversationId, message } = req.body || {};

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Message cannot be empty.' } });
    }

    let convoId = conversationId;
    if (convoId) {
      const owned = db.prepare('SELECT id FROM coach_conversations WHERE id = ? AND user_id = ?').get(convoId, user.id);
      if (!owned) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
      }
    } else {
      convoId = crypto.randomUUID();
      const title = message.trim().slice(0, 45) + (message.length > 45 ? '...' : '');
      db.prepare('INSERT INTO coach_conversations (id, user_id, title) VALUES (?, ?, ?)').run(convoId, user.id, title);
    }

    const { resume: latestResume, jd: latestJd } = getLatestUserDocuments(user.id);
    const latestAnalysis = db.prepare("SELECT result_json FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(user.id) as any;
    const latestInterview = db.prepare("SELECT final_report_json FROM interview_sessions WHERE user_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1").get(user.id) as any;

    const prevRows = db
      .prepare('SELECT role, content FROM (SELECT role, content, created_at FROM coach_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 10) ORDER BY created_at ASC')
      .all(convoId) as any[];

    const userMsgId = crypto.randomUUID();
    db.prepare('INSERT INTO coach_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)').run(userMsgId, convoId, 'user', message.trim());

    const response = await coachChat({
      message: message.trim(),
      conversationHistory: prevRows,
      context: {
        userName: user.name,
        targetRole: user.target_role || undefined,
        targetCompany: user.target_company || undefined,
        resumeText: latestResume?.extracted_text,
        jdText: latestJd?.extracted_text,
        analysis: latestAnalysis?.result_json ? safeDbJsonParse(latestAnalysis.result_json, null) : null,
        lastSessionReport: latestInterview?.final_report_json ? safeDbJsonParse(latestInterview.final_report_json, null) : null,
      },
    });

    const assistantMsgId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO coach_messages (id, conversation_id, role, content, citations_json)
      VALUES (?, ?, 'assistant', ?, ?)
    `).run(
      assistantMsgId,
      convoId,
      response.answer,
      JSON.stringify(response.citations)
    );
    db.prepare("UPDATE coach_conversations SET updated_at = datetime('now') WHERE id = ?").run(convoId);

    res.json({
      conversationId: convoId,
      answer: response.answer,
      citations: response.citations,
      suggestedFollowUps: response.suggestedFollowUps,
      generationMode: response.generationMode,
      aiNotice: response.aiNotice,
    });
  } catch (err: any) {
    console.error('Error in POST /api/coach/chat:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message || 'Coach request failed.' } });
  }
});

apiRouter.post('/coach/chat/stream', authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { conversationId, message } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Message cannot be empty.' } });
  }

  let convoId = conversationId;
  if (convoId) {
    const owned = db.prepare('SELECT id FROM coach_conversations WHERE id = ? AND user_id = ?').get(convoId, user.id);
    if (!owned) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
    }
  } else {
    convoId = crypto.randomUUID();
    const title = message.trim().slice(0, 45) + (message.length > 45 ? '...' : '');
    db.prepare('INSERT INTO coach_conversations (id, user_id, title) VALUES (?, ?, ?)').run(convoId, user.id, title);
  }

  // Set SSE Headers
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

  // Save user message to DB
  const userMsgId = crypto.randomUUID();
  db.prepare('INSERT INTO coach_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)').run(
    userMsgId,
    convoId,
    'user',
    message.trim()
  );
  db.prepare("UPDATE coach_conversations SET updated_at = datetime('now') WHERE id = ?").run(convoId);

  sendEvent({ type: 'init', conversationId: convoId, userMessageId: userMsgId });

  const { resume: latestResume, jd: latestJd } = getLatestUserDocuments(user.id);
  const latestAnalysis = db.prepare("SELECT result_json FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(user.id) as any;
  const latestInterview = db.prepare("SELECT final_report_json FROM interview_sessions WHERE user_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1").get(user.id) as any;

  // Retrieve previous recent messages (excluding just-inserted message if identical timestamp)
  const prevRows = db
    .prepare('SELECT role, content FROM (SELECT role, content, created_at FROM coach_messages WHERE conversation_id = ? AND id != ? ORDER BY created_at DESC LIMIT 10) ORDER BY created_at ASC')
    .all(convoId, userMsgId) as any[];

  let accumulated = '';
  try {
    const result = await coachChatStream(
      {
        message: message.trim(),
        conversationHistory: prevRows,
        context: {
          userName: user.name,
          targetRole: user.target_role || undefined,
          targetCompany: user.target_company || undefined,
          resumeText: latestResume?.extracted_text,
          jdText: latestJd?.extracted_text,
          analysis: latestAnalysis?.result_json ? safeDbJsonParse(latestAnalysis.result_json, null) : null,
          lastSessionReport: latestInterview?.final_report_json ? safeDbJsonParse(latestInterview.final_report_json, null) : null,
        },
      },
      {
        onChunk: (chunk: string) => {
          accumulated += chunk;
          sendEvent({ type: 'chunk', text: chunk });
        },
      },
      abortController.signal
    );

    const assistantMsgId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO coach_messages (id, conversation_id, role, content, citations_json)
      VALUES (?, ?, 'assistant', ?, ?)
    `).run(
      assistantMsgId,
      convoId,
      result.answer,
      JSON.stringify(result.citations)
    );
    db.prepare("UPDATE coach_conversations SET updated_at = datetime('now') WHERE id = ?").run(convoId);

    sendEvent({
      type: 'done',
      messageId: assistantMsgId,
      answer: result.answer,
      citations: result.citations,
      suggestedFollowUps: result.suggestedFollowUps,
      generationMode: result.generationMode,
      aiNotice: result.aiNotice,
    });
  } catch (err: any) {
    if (isAborted) {
      if (accumulated.trim().length > 0) {
        const partialAnswer = accumulated.replace(/\n*---\s*\n*(?:CITATIONS:|FOLLOW_UPS:|SUGGESTIONS:)[\s\S]*$/i, '').trim();
        const assistantMsgId = crypto.randomUUID();
        try {
          db.prepare(`
            INSERT INTO coach_messages (id, conversation_id, role, content, citations_json)
            VALUES (?, ?, 'assistant', ?, ?)
          `).run(
            assistantMsgId,
            convoId,
            partialAnswer + ' *(generation paused)*',
            JSON.stringify(['Candidate Context'])
          );
        } catch {}
      }
    } else {
      console.error('Error during coachChatStream:', err);
      sendEvent({ type: 'error', message: err.message || 'Stream processing failed' });
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

apiRouter.get('/coach/conversations', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const convos = db.prepare('SELECT id, title, created_at, updated_at FROM coach_conversations WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
  res.json({ conversations: convos });
});

apiRouter.get('/coach/conversations/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const convo = db.prepare('SELECT id, title, created_at FROM coach_conversations WHERE id = ? AND user_id = ?').get(req.params.id, userId) as any;
  if (!convo) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
  }

  const messages = db.prepare('SELECT id, role, content, citations_json, created_at FROM coach_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(convo.id) as any[];

  res.json({
    conversation: convo,
    messages: messages.map(m => ({
      ...m,
      citations: m.citations_json ? safeDbJsonParse(m.citations_json, []) : [],
    })),
  });
});

apiRouter.delete('/coach/conversations/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const result = db.prepare('DELETE FROM coach_conversations WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
  }
  res.json({ success: true, message: 'Conversation deleted.' });
});

/* ==========================================================================
   STUDY PACKS & PDF DOWNLOAD
   ========================================================================== */
apiRouter.post('/study-packs', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { analysisId } = req.body || {};

    let analysisRow: any = null;
    if (analysisId) {
      analysisRow = db.prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?').get(analysisId, user.id);
    }
    if (!analysisRow) {
      analysisRow = db.prepare('SELECT * FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id);
    }

    if (!analysisRow) {
      return res.status(400).json({ error: { code: 'NOT_FOUND', message: 'Please complete a resume and job description analysis first.' } });
    }

    const company = analysisRow.target_company || user.target_company || 'Target Company';
    const role = analysisRow.target_role || user.target_role || 'Target Role';

    const companyResearch = await researchCompany(company, role);
    const analysisData = safeDbJsonParse(analysisRow.result_json, {});

    const studyPackId = crypto.randomUUID();
    const title = `${company} — ${role} Master Study Pack`;

    const packContent = {
      userName: user.name,
      targetRole: role,
      targetCompany: company,
      generationDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      analysis: analysisData,
      companyResearch,
    };

    db.prepare(`
      INSERT INTO study_packs (id, user_id, analysis_id, status, title, source_manifest_json, content_json)
      VALUES (?, ?, ?, 'ready', ?, ?, ?)
    `).run(
      studyPackId,
      user.id,
      analysisRow.id,
      title,
      JSON.stringify(companyResearch.sourcedFacts),
      JSON.stringify(packContent)
    );

    logAuditEvent(user.id, 'STUDY_PACK_GENERATED', { studyPackId, company, role });

    res.status(201).json({
      studyPackId,
      status: 'ready',
      title,
      content: packContent,
    });
  } catch (err: any) {
    console.error('Error generating study pack:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to generate study pack.' } });
  }
});

apiRouter.get('/study-packs', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const packs = db.prepare('SELECT id, analysis_id, status, title, created_at FROM study_packs WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  res.json({ studyPacks: packs });
});

apiRouter.get('/study-packs/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const pack = db.prepare('SELECT * FROM study_packs WHERE id = ? AND user_id = ?').get(req.params.id, userId) as any;
  if (!pack) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Study pack not found.' } });
  }
  res.json({
    studyPack: {
      id: pack.id,
      title: pack.title,
      status: pack.status,
      createdAt: pack.created_at,
      content: safeDbJsonParse(pack.content_json, {}),
    },
  });
});

apiRouter.get('/study-packs/:id/download', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const pack = db.prepare('SELECT * FROM study_packs WHERE id = ? AND user_id = ?').get(req.params.id, userId) as any;
  if (!pack) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Study pack not found.' } });
  }

  const content = safeDbJsonParse<any>(pack.content_json, null);
  if (!content) {
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Study pack content is unreadable.' } });
  }
  const pdfBuffer = generateStudyPackPdf(content);

  const safeFilename = `${pack.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.send(pdfBuffer);
});

apiRouter.delete('/study-packs/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const result = db.prepare('DELETE FROM study_packs WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Study pack not found.' } });
  }
  res.json({ success: true, message: 'Study pack deleted.' });
});

// JSON API error fallback to prevent leaking HTML error pages on /api/*
apiRouter.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled API error:', err?.message || err);
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({
    error: {
      code: err?.code || 'INTERNAL_ERROR',
      message: err?.message || 'An unexpected server error occurred.',
    },
  });
});
