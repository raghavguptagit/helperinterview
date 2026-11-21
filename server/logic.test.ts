import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { jsPDF } from 'jspdf';
import { initDatabase, db } from './db.js';
import { createSession, getUserFromToken, revokeSession } from './auth.js';
import { researchCompany } from './search.js';
import { generateStudyPackPdf } from './pdf.js';
import { extractTextFromBuffer, DocumentValidationError, sanitizeFilename } from './documents.js';
import { extractTechnologies, extractResumeProjects, extractJdRequirements } from './resumeParser.js';
import { apiRouter } from './routes.js';

function createSamplePdfBuffer(lines: string[]): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 40;
  for (const line of lines) {
    doc.text(line, 40, y);
    y += 18;
  }
  return Buffer.from(doc.output('arraybuffer'));
}

test('database initializes schema and seeds demo user', () => {
  initDatabase();
  const user = db.prepare('SELECT id, name, email FROM app_users WHERE email = ?').get('raghav@example.com') as any;
  assert.ok(user, 'Demo user should be seeded');
  assert.equal(user.name, 'Raghav');
  assert.equal(user.email, 'raghav@example.com');
});

test('session creation, retrieval, and revocation work securely', () => {
  initDatabase();
  const user = db.prepare('SELECT id FROM app_users WHERE email = ?').get('raghav@example.com') as any;
  assert.ok(user);

  const token = createSession(user.id);
  assert.ok(typeof token === 'string' && token.length > 20);

  const retrieved = getUserFromToken(token);
  assert.ok(retrieved);
  assert.equal(retrieved.id, user.id);
  assert.equal(retrieved.name, 'Raghav');

  revokeSession(token);
  const afterRevoke = getUserFromToken(token);
  assert.equal(afterRevoke, null, 'Revoked token must yield null');
});

test('document extraction parses valid PDF & TXT and rejects invalid/empty/corrupt files', async () => {
  const pdfBuf = createSamplePdfBuffer([
    'Priya Sharma - Backend Python Engineer',
    'Skills: Python, FastAPI, PostgreSQL, Docker, AWS',
    'Projects:',
    '1. Telemetry Stream Pipeline: Built high-throughput Kafka and Python analytics.',
  ]);
  const extractedPdf = await extractTextFromBuffer(pdfBuf, 'application/pdf', 'priya_resume.pdf');
  assert.match(extractedPdf, /Priya Sharma/i);
  assert.match(extractedPdf, /FastAPI/i);

  const txtBuf = Buffer.from('Senior Python Backend Developer with FastAPI, PostgreSQL, and Docker experience.', 'utf-8');
  const extractedTxt = await extractTextFromBuffer(txtBuf, 'text/plain', 'jd.txt');
  assert.match(extractedTxt, /Python Backend Developer/i);

  await assert.rejects(
    () => extractTextFromBuffer(Buffer.alloc(0), 'application/pdf', 'empty.pdf'),
    (err: any) => err instanceof DocumentValidationError && err.code === 'EMPTY_FILE'
  );

  await assert.rejects(
    () => extractTextFromBuffer(Buffer.from('not a real pdf binary', 'utf-8'), 'application/pdf', 'corrupt.pdf'),
    (err: any) => err instanceof DocumentValidationError && err.code === 'CORRUPTED_PDF'
  );

  await assert.rejects(
    () => extractTextFromBuffer(Buffer.from('legacy word binary'), 'application/msword', 'old_resume.doc'),
    (err: any) => err instanceof DocumentValidationError && err.code === 'UNSUPPORTED_FORMAT'
  );

  const emptyPdf = createSamplePdfBuffer([]);
  await assert.rejects(
    () => extractTextFromBuffer(emptyPdf, 'application/pdf', 'blank.pdf'),
    (err: any) => err instanceof DocumentValidationError && err.code === 'EMPTY_EXTRACTED_TEXT'
  );

  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
});

test('resumeParser extracts technologies, projects, and JD matches dynamically', () => {
  const resume = `Alex Rivera
Senior ML & Backend Engineer
Skills: Python, FastAPI, React, TypeScript, PostgreSQL, Docker, PyTorch
Projects:
1. FraudLens Real-Time Scorer:
Built a FastAPI and PyTorch fraud inference service scoring 2,500 requests/sec with PostgreSQL audit logging.
2. VectorSearch Workspace:
Architected semantic document indexing with React and TypeScript frontend.`;

  const jd = `- Build production Python and FastAPI microservices backed by PostgreSQL
- Collaborate on React and TypeScript developer dashboards
- Experience deploying containerized workloads with Docker and Kubernetes`;

  const techs = extractTechnologies(resume, jd);
  assert.ok(techs.includes('Python'));
  assert.ok(techs.includes('FastAPI / Django / Flask'));
  assert.ok(techs.includes('React'));
  assert.ok(techs.includes('AI / ML'));

  const projects = extractResumeProjects(resume);
  assert.ok(projects.length >= 2);
  assert.match(projects[0].name, /FraudLens/i);

  const reqs = extractJdRequirements(jd, resume);
  assert.ok(reqs.length >= 2);
  assert.ok(reqs.some((r) => r.status === 'matched' || r.status === 'partial'));
});

test('company research returns sourced facts with citations and practice questions', async () => {
  const result = await researchCompany('Stripe', 'Senior Full-Stack Engineer');
  assert.equal(result.company, 'Stripe');
  assert.ok(result.overview.length > 20);
  assert.ok(result.sourcedFacts.length > 0);
  assert.ok(result.sourcedFacts[0].sourceUrl.startsWith('http'));
  assert.ok(result.practiceQuestions.length >= 3);
  assert.equal(result.practiceQuestions[0].isVerifiedHistoricalQuestion, false);
});

test('PDF study pack generation produces valid PDF buffer', async () => {
  const research = await researchCompany('Stripe', 'Senior Full-Stack Engineer');
  const buffer = generateStudyPackPdf({
    userName: 'Raghav',
    targetRole: 'Senior Full-Stack Engineer',
    targetCompany: 'Stripe',
    generationDate: '2026-10-26',
    analysis: {
      overallMatchScore: 92,
      profileSummary: 'Strong match for Stripe Billing infrastructure.',
      requirementsMatch: [
        { requirement: 'TypeScript & React', status: 'matched', evidence: '6 years experience', importance: 'high' }
      ],
      strengths: ['Deep PostgreSQL knowledge'],
      gaps: ['Elaborate Kafka consumer scaling'],
      truthfulKeywordSuggestions: ['Idempotency Keys'],
      likelyTopics: ['System Design'],
      studyPlan: [{ day: 1, focus: 'Idempotency', task: 'Revise SETNX' }],
      uncertaintyNotes: []
    },
    companyResearch: research
  });

  assert.ok(Buffer.isBuffer(buffer), 'Should be a Node Buffer');
  assert.ok(buffer.length > 1000, 'PDF buffer should contain valid PDF data');
  const header = buffer.subarray(0, 5).toString('ascii');
  assert.equal(header, '%PDF-');
});

test('end-to-end API flow: upload PDF resume & JD, run analysis, all 3 mock interviews, 8-dim scoring & IDOR isolation', async () => {
  initDatabase();
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const createdUserIds: string[] = [];

  try {
    // 1. Register two isolated test users
    const email1 = `qa_user_${Date.now()}@example.com`;
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'QA Candidate',
        email: email1,
        password: 'TestPassword123!',
        target_role: 'Backend Python Engineer',
        target_company: 'Stripe',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData: any = await regRes.json();
    createdUserIds.push(regData.user.id);
    const token1 = regData.token;

    const email2 = `qa_other_${Date.now()}@example.com`;
    const reg2Res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Other User',
        email: email2,
        password: 'TestPassword123!',
      }),
    });
    assert.equal(reg2Res.status, 201);
    const reg2Data: any = await reg2Res.json();
    createdUserIds.push(reg2Data.user.id);
    const token2 = reg2Data.token;

    // 2. Upload valid PDF Resume via multipart FormData
    const resumePdf = createSamplePdfBuffer([
      'QA Candidate - Backend Python Engineer',
      'Skills: Python, FastAPI, PostgreSQL, Redis, Docker',
      'Projects:',
      '1. OrderLedger API:',
      'Built idempotent Python FastAPI order processing API backed by PostgreSQL.',
    ]);
    const resumeFd = new FormData();
    resumeFd.append('file', new Blob([new Uint8Array(resumePdf)], { type: 'application/pdf' }), 'qa_resume.pdf');

    const upResume = await fetch(`${baseUrl}/documents/resume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token1}` },
      body: resumeFd,
    });
    assert.equal(upResume.status, 201);
    const resumeJson: any = await upResume.json();
    assert.ok(resumeJson.documentId);
    assert.match(resumeJson.extractedText, /OrderLedger API/);
    assert.ok(resumeJson.detectedProjects.length >= 1);

    // 3. Reject corrupted PDF cleanly with JSON 422
    const badFd = new FormData();
    badFd.append('file', new Blob([Buffer.from('corrupt bytes')], { type: 'application/pdf' }), 'broken.pdf');
    const badUp = await fetch(`${baseUrl}/documents/resume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token1}` },
      body: badFd,
    });
    assert.equal(badUp.status, 422);
    const badJson: any = await badUp.json();
    assert.equal(badJson.error.code, 'CORRUPTED_PDF');

    // 4. Upload TXT JD via multipart FormData
    const jdFd = new FormData();
    jdFd.append(
      'file',
      new Blob(['Looking for a Python FastAPI engineer with PostgreSQL concurrency and Docker production experience.'], {
        type: 'text/plain',
      }),
      'backend_jd.txt'
    );
    const upJd = await fetch(`${baseUrl}/documents/jd`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token1}` },
      body: jdFd,
    });
    assert.equal(upJd.status, 201);
    const jdJson: any = await upJd.json();
    assert.ok(jdJson.documentId);

    // 5. Verify /documents/latest and /interviews/context hydrate uploaded docs
    const ctxRes = await fetch(`${baseUrl}/interviews/context`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(ctxRes.status, 200);
    const ctxJson: any = await ctxRes.json();
    assert.equal(ctxJson.resumeLoaded, true);
    assert.equal(ctxJson.jdLoaded, true);
    assert.ok(ctxJson.detectedTechnologies.includes('Python'));

    // 6. Run Analysis
    const analysisRes = await fetch(`${baseUrl}/analysis`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resumeDocumentId: resumeJson.documentId,
        jdDocumentId: jdJson.documentId,
        targetRole: 'Backend Python Engineer',
        targetCompany: 'Stripe',
      }),
    });
    assert.equal(analysisRes.status, 201);
    const analysisData: any = await analysisRes.json();
    assert.ok(analysisData.analysisId);
    assert.ok(analysisData.result.requirementsMatch.length >= 1);

    // 7. Start all 3 mock interview tracks + verify tailored question generation
    for (const track of ['hr', 'technical', 'project_mixed'] as const) {
      const startRes = await fetch(`${baseUrl}/interviews`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: track,
          focusTechnologies: track === 'technical' ? ['Python'] : undefined,
          selectedProject: track === 'project_mixed' ? 'OrderLedger API' : undefined,
        }),
      });
      assert.equal(startRes.status, 201, `Track ${track} should start cleanly`);
      const startJson: any = await startRes.json();
      assert.ok(startJson.sessionId);
      assert.ok(startJson.currentTurn.question.length > 20);
      if (track === 'technical') {
        assert.match(startJson.currentTurn.question, /Python|FastAPI|GIL|async/i);
      }
      if (track === 'project_mixed') {
        assert.match(startJson.currentTurn.question, /OrderLedger API/);
      }

      // IDOR isolation check: user 2 cannot view or end user 1's interview
      const idorRes = await fetch(`${baseUrl}/interviews/${startJson.sessionId}`, {
        headers: { Authorization: `Bearer ${token2}` },
      });
      assert.equal(idorRes.status, 404);

      // Submit an answer and verify 8-dim feedback
      const ansRes = await fetch(`${baseUrl}/interviews/${startJson.sessionId}/answer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          turnId: startJson.currentTurn.turnId,
          answerText:
            'In OrderLedger API, I implemented idempotent Python FastAPI endpoints using Redis SETNX locks and PostgreSQL unique constraints, reducing duplicate writes by 99.8% under load.',
        }),
      });
      assert.equal(ansRes.status, 200);
      const ansJson: any = await ansRes.json();
      assert.equal(Object.keys(ansJson.feedback.scores).length, 8);
      assert.ok(ansJson.nextTurn.turnId);

      // End interview and verify all 8 categoryScores in FinalReport
      const endRes = await fetch(`${baseUrl}/interviews/${startJson.sessionId}/end`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pausedSeconds: 0 }),
      });
      assert.equal(endRes.status, 200);
      const endJson: any = await endRes.json();
      assert.equal(endJson.report.questionsAnswered, 1);
      assert.equal(Object.keys(endJson.report.categoryScores).length, 8);
      assert.ok(endJson.report.overallScore > 0);
    }

    // 8. Verify unanswered session ends honestly with 0 score
    const emptyStartRes = await fetch(`${baseUrl}/interviews`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token1}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'hr' }),
    });
    const emptyStartJson: any = await emptyStartRes.json();
    const emptyEndRes = await fetch(`${baseUrl}/interviews/${emptyStartJson.sessionId}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token1}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pausedSeconds: 0 }),
    });
    const emptyEndJson: any = await emptyEndRes.json();
    assert.equal(emptyEndJson.report.questionsAnswered, 0);
    assert.equal(emptyEndJson.report.overallScore, 0);
  } finally {
    for (const uid of createdUserIds) {
      db.prepare('DELETE FROM app_users WHERE id = ?').run(uid);
    }
    server.close();
  }
});
