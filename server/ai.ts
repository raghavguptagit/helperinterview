import { GoogleGenAI, Type } from '@google/genai';
import {
  extractTechnologies,
  extractResumeProjects,
  extractJdRequirements,
  type ExtractedProject,
} from './resumeParser.js';

// Initialize Gemini client server-side only
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
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

// Active candidate models with graceful cascade
function getCandidateModels(): string[] {
  const preferred = process.env.GEMINI_MODEL?.trim();
  const list = [
    preferred,
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash',
  ].filter(Boolean) as string[];
  return Array.from(new Set(list));
}

export type GenerationMode = 'gemini' | 'fallback';

async function generateWithModelFallback(params: {
  contents: any;
  config?: any;
}): Promise<{ text: string | null; modelUsed?: string; errorReason?: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      text: null,
      errorReason: 'GEMINI_API_KEY is not configured in server environment; using resume-aware rule engine.',
    };
  }

  const models = getCandidateModels();
  let lastError = 'No response returned by Gemini API.';
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        });
        if (response && response.text && response.text.trim().length > 0) {
          return { text: response.text, modelUsed: model };
        }
      } catch (err: any) {
        const status = err?.status || '';
        const msg = String(err?.message || 'Unknown upstream error')
          .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]')
          .slice(0, 140);
        lastError = `${model} (${status || 'error'}): ${msg}`;
        console.warn(`Gemini model [${model}] attempt ${attempt + 1} failed: ${lastError}`);
        // Do not retry immediately on auth/400 errors; move to next model or fail cleanly
        if (status === 400 || status === 401 || status === 403 || status === 404) {
          break;
        }
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 350));
        }
      }
    }
  }
  return { text: null, errorReason: lastError };
}

// Robust JSON parser for AI outputs (handles code fences, trailing text, etc.)
function safeParseJson<T>(rawText: string, fallback: T): { value: T; parsedFromAi: boolean } {
  try {
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return { value: JSON.parse(cleaned) as T, parsedFromAi: true };
  } catch {
    const match = rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return { value: JSON.parse(match[1]) as T, parsedFromAi: true };
      } catch {
        // fall through
      }
    }
    return { value: fallback, parsedFromAi: false };
  }
}

export interface AnalysisOutput {
  overallMatchScore: number;
  profileSummary: string;
  requirementsMatch: {
    requirement: string;
    status: 'matched' | 'partial' | 'missing' | 'not_assessable';
    evidence: string;
    importance: 'high' | 'medium' | 'low';
  }[];
  strengths: string[];
  gaps: string[];
  truthfulKeywordSuggestions: string[];
  likelyTopics: string[];
  studyPlan: {
    day: number;
    focus: string;
    task: string;
  }[];
  uncertaintyNotes: string[];
  generationMode?: GenerationMode;
  aiNotice?: string;
}

export interface QuestionOutput {
  questionId: string;
  questionText: string;
  category: 'HR' | 'TECHNICAL' | 'PROJECT' | 'SITUATIONAL';
  rationale: string;
  expectedSignals: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  followUpStrategy: string;
  generationMode?: GenerationMode;
  aiNotice?: string;
}

export interface FeedbackOutput {
  scores: {
    technicalCorrectness: number;
    relevance: number;
    completeness: number;
    structure: number;
    communicationClarity: number;
    grammarVocabulary: number;
    conciseness: number;
    projectEvidence: number;
  };
  whatWorked: string[];
  missingPoints: string[];
  technicalCorrections: string[];
  grammarSuggestions: string[];
  improvedAnswer: string;
  practiceTask: string;
  suggestedFollowUp: string;
  generationMode?: GenerationMode;
  aiNotice?: string;
}

/**
 * 1. Resume and Job Description Analysis
 */
export async function analyzeResumeAndJd(
  resumeText: string,
  jdText: string,
  targetRole: string,
  targetCompany: string
): Promise<AnalysisOutput> {
  const detectedTechs = extractTechnologies(resumeText, jdText);
  const detectedProjects = extractResumeProjects(resumeText);

  const prompt = `You are a rigorous, truthful career preparation assistant.
Analyze the provided resume against the job description for the target role: "${targetRole}" at company: "${targetCompany}".

RULES:
- Do NOT invent degrees, years of experience, tools, metrics, or outcomes that are not explicitly stated in the resume.
- For every requirement, mark status as: "matched", "partial", "missing", or "not_assessable".
- Provide exact quote evidence from the resume or clearly state that evidence is missing.
- List truthful keywords that the candidate legitimately possesses based on their resume evidence.
- Produce a realistic 7-day preparation roadmap tailored to their gaps and detected stack (${detectedTechs.join(', ') || 'candidate stack'}).
- Disclose any uncertainty in uncertaintyNotes.

RESUME TEXT:
"""
${resumeText.slice(0, 8000)}
"""

JOB DESCRIPTION:
"""
${jdText.slice(0, 8000)}
"""
`;

  const aiRes = await generateWithModelFallback({
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallMatchScore: { type: Type.INTEGER, description: 'Percentage 0-100 of match' },
          profileSummary: { type: Type.STRING, description: 'Truthful 2-3 sentence overview' },
          requirementsMatch: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                requirement: { type: Type.STRING },
                status: { type: Type.STRING },
                evidence: { type: Type.STRING },
                importance: { type: Type.STRING },
              },
              required: ['requirement', 'status', 'evidence', 'importance'],
            },
          },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
          truthfulKeywordSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          likelyTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
          studyPlan: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                day: { type: Type.INTEGER },
                focus: { type: Type.STRING },
                task: { type: Type.STRING },
              },
              required: ['day', 'focus', 'task'],
            },
          },
          uncertaintyNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'overallMatchScore',
          'profileSummary',
          'requirementsMatch',
          'strengths',
          'gaps',
          'truthfulKeywordSuggestions',
          'likelyTopics',
          'studyPlan',
          'uncertaintyNotes',
        ],
      },
    },
  });

  const fallback = fallbackAnalyze(
    resumeText,
    jdText,
    targetRole,
    targetCompany,
    detectedTechs,
    detectedProjects,
    aiRes.errorReason
  );

  if (aiRes.text) {
    const parsed = safeParseJson<AnalysisOutput>(aiRes.text, fallback);
    if (parsed.parsedFromAi) {
      return {
        ...parsed.value,
        generationMode: 'gemini',
        aiNotice: `Generated live using ${aiRes.modelUsed || 'Gemini AI'}`,
      };
    }
  }

  return fallback;
}

/**
 * 2. Question Generation (One question at a time)
 */
export async function generateQuestion(params: {
  sessionType: 'hr' | 'technical' | 'project_mixed';
  targetRole: string;
  targetCompany: string;
  resumeText: string;
  jdText: string;
  sequenceNo: number;
  previousTurns: { question: string; answer: string }[];
  focusTechnologies?: string[];
  selectedProject?: string;
}): Promise<QuestionOutput> {
  const {
    sessionType,
    targetRole,
    targetCompany,
    resumeText,
    jdText,
    sequenceNo,
    previousTurns,
    focusTechnologies = [],
    selectedProject,
  } = params;

  const detectedTechs = extractTechnologies(resumeText, jdText);
  const effectiveTechs =
    focusTechnologies.length > 0 ? focusTechnologies : detectedTechs;
  const detectedProjects = extractResumeProjects(resumeText);

  const trackSpecificDirective =
    sessionType === 'hr'
      ? `HR / BEHAVIORAL FOCUS:
- Cover core HR topics across turns: Self-introduction ("Tell me about yourself"), Strengths & Weaknesses, Career Goals, Teamwork, Conflict Handling, Why Join ${targetCompany} / Why Should We Hire You, and STAR Situational Decisions.
- Do NOT ask low-level coding trivia.`
      : sessionType === 'technical'
      ? `TECHNICAL FOCUS:
- Focus technologies requested/detected: ${effectiveTechs.join(', ') || 'General Software Engineering'}
- Tailor technical questions directly to these technologies, the candidate's resume skills, experience level, and the job description.
- Do NOT ask about unrelated technologies absent from both the focus list and the resume/JD.`
      : `PROJECT DEEP-DIVE FOCUS:
- Detected Projects from Candidate Resume:
${detectedProjects.length > 0 ? detectedProjects.map((p, i) => `${i + 1}. "${p.name}" (${p.technologies.join(', ') || 'General'}) — ${p.description}`).join('\n') : 'No explicit project section detected; ask about their most significant real-world project.'}
${selectedProject ? `- Candidate specifically requested focus on project: "${selectedProject}".` : ''}
- Ask concrete questions about the actual projects named in their resume: problem statement, architecture, why technologies were chosen, workflow, bugs/challenges, database/API design, deployment, limitations, and future improvements.`;

  const prompt = `You are an encouraging, experienced mock interviewer conducting a structured 20-minute interview.
Interview Track: ${sessionType.toUpperCase()}
Target Role: ${targetRole}
Target Company: ${targetCompany}
Current Question Sequence: #${sequenceNo}

${trackSpecificDirective}

CANDIDATE RESUME:
"""
${resumeText ? resumeText.slice(0, 4500) : 'No resume uploaded yet.'}
"""

JOB DESCRIPTION:
"""
${jdText ? jdText.slice(0, 3000) : 'No job description uploaded yet.'}
"""

PREVIOUS CONVERSATION TURNS IN THIS SESSION:
${previousTurns.length > 0 ? previousTurns.map((t, idx) => `Turn ${idx + 1}:\nInterviewer: "${t.question}"\nCandidate: "${t.answer || '(pending)'}"`).join('\n\n') : 'None (Opening Question #1)'}

INSTRUCTIONS:
1. Generate EXACTLY ONE unique question for the candidate that has NOT been asked in previous turns.
2. Make it specific to the track, candidate's resume, technologies, and projects above.
3. Do NOT reveal the ideal answer.
4. Strictly adhere to the requested JSON format.
`;

  const aiRes = await generateWithModelFallback({
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          questionId: { type: Type.STRING },
          questionText: { type: Type.STRING },
          category: { type: Type.STRING },
          rationale: { type: Type.STRING },
          expectedSignals: { type: Type.ARRAY, items: { type: Type.STRING } },
          difficulty: { type: Type.STRING },
          followUpStrategy: { type: Type.STRING },
        },
        required: [
          'questionId',
          'questionText',
          'category',
          'rationale',
          'expectedSignals',
          'difficulty',
          'followUpStrategy',
        ],
      },
    },
  });

  const fallback = fallbackQuestion({
    sessionType,
    targetRole,
    targetCompany,
    sequenceNo,
    previousTurns,
    resumeText,
    jdText,
    focusTechnologies: effectiveTechs,
    detectedProjects,
    selectedProject,
    errorReason: aiRes.errorReason,
  });

  if (aiRes.text) {
    const parsed = safeParseJson<QuestionOutput>(aiRes.text, fallback);
    if (parsed.parsedFromAi && parsed.value?.questionText) {
      return {
        ...parsed.value,
        generationMode: 'gemini',
        aiNotice: `Generated live using ${aiRes.modelUsed || 'Gemini AI'}`,
      };
    }
  }

  return fallback;
}

/**
 * 3. Answer Evaluation (8 Rubric Dimensions)
 */
export async function evaluateAnswer(params: {
  question: string;
  questionCategory: string;
  answer: string;
  resumeText: string;
  jdText: string;
}): Promise<FeedbackOutput> {
  const { question, questionCategory, answer, resumeText, jdText } = params;

  const prompt = `You are a supportive, rigorous interview evaluator.
Evaluate the candidate's answer using the 8-dimension rubric (0.0 to 5.0 score for each):
1. Technical correctness
2. Relevance to question and JD
3. Completeness and reasoning
4. Answer structure (STAR method for behavioral questions)
5. Communication clarity
6. English grammar and vocabulary
7. Conciseness (avoiding rambles)
8. Project / resume evidence used

RULES:
- Be honest: short, vague, or off-topic answers must receive appropriately low scores (e.g., 1.0 - 2.5).
- Separate technical accuracy from English language fluency.
- Never invent facts about the candidate's experience.
- Provide practical corrections and an improved sample answer using ONLY user-provided facts.
- Include a specific practice task and follow-up question.

QUESTION ASKED:
"${question}" (Category: ${questionCategory})

CANDIDATE'S ANSWER:
"${answer}"

CONTEXT (RESUME):
"""
${resumeText ? resumeText.slice(0, 3000) : 'No resume uploaded'}
"""

CONTEXT (JOB DESCRIPTION):
"""
${jdText ? jdText.slice(0, 2000) : 'No JD uploaded'}
"""
`;

  const aiRes = await generateWithModelFallback({
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          scores: {
            type: Type.OBJECT,
            properties: {
              technicalCorrectness: { type: Type.NUMBER },
              relevance: { type: Type.NUMBER },
              completeness: { type: Type.NUMBER },
              structure: { type: Type.NUMBER },
              communicationClarity: { type: Type.NUMBER },
              grammarVocabulary: { type: Type.NUMBER },
              conciseness: { type: Type.NUMBER },
              projectEvidence: { type: Type.NUMBER },
            },
            required: [
              'technicalCorrectness',
              'relevance',
              'completeness',
              'structure',
              'communicationClarity',
              'grammarVocabulary',
              'conciseness',
              'projectEvidence',
            ],
          },
          whatWorked: { type: Type.ARRAY, items: { type: Type.STRING } },
          missingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
          technicalCorrections: { type: Type.ARRAY, items: { type: Type.STRING } },
          grammarSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvedAnswer: { type: Type.STRING },
          practiceTask: { type: Type.STRING },
          suggestedFollowUp: { type: Type.STRING },
        },
        required: [
          'scores',
          'whatWorked',
          'missingPoints',
          'technicalCorrections',
          'grammarSuggestions',
          'improvedAnswer',
          'practiceTask',
          'suggestedFollowUp',
        ],
      },
    },
  });

  const fallback = fallbackFeedback(question, answer, resumeText, aiRes.errorReason);

  if (aiRes.text) {
    const parsed = safeParseJson<FeedbackOutput>(aiRes.text, fallback);
    if (parsed.parsedFromAi && parsed.value?.scores) {
      return {
        ...parsed.value,
        generationMode: 'gemini',
        aiNotice: `Evaluated live using ${aiRes.modelUsed || 'Gemini AI'}`,
      };
    }
  }

  return fallback;
}

/**
 * 4. Ask Me AI Coach Conversation
 */
export async function coachChat(params: {
  message: string;
  conversationHistory: { role: string; content: string }[];
  context: {
    userName: string;
    targetRole?: string;
    targetCompany?: string;
    resumeText?: string;
    jdText?: string;
    analysis?: any;
    lastSessionReport?: any;
  };
}): Promise<{
  answer: string;
  citations: string[];
  suggestedFollowUps: string[];
  generationMode?: GenerationMode;
  aiNotice?: string;
}> {
  const { message, conversationHistory, context } = params;

  const systemInstruction = `You are "Personal AI Coach", a warm, intelligent, transparent AI mentor helping ${context.userName} prepare for their dream role (${context.targetRole || 'Software Engineer'} at ${context.targetCompany || 'Top Tech'}).
Be transparent that you are an AI assistant.
Answer in the language or dialect style the user speaks in (English, Hindi, or Hinglish) with clarity, depth, and practical guidance.
Ground your answers strictly in the candidate's verified resume, target JD, previous mock interview sessions, and preparation plan.
Never invent qualifications, numbers, or achievements.
Disclose uncertainty when information is missing and ask a focused follow-up question.
Offer clear, actionable, encouraging advice.`;

  const prompt = `User's question: "${message}"

CANDIDATE RESUME SUMMARY:
${context.resumeText ? context.resumeText.slice(0, 2500) : 'None uploaded'}

TARGET JOB DESCRIPTION:
${context.jdText ? context.jdText.slice(0, 2500) : 'None specified'}

RECENT INTERVIEW HIGHLIGHTS:
${context.lastSessionReport ? JSON.stringify(context.lastSessionReport).slice(0, 1500) : 'No sessions completed yet'}

CONVERSATION HISTORY:
${conversationHistory.slice(-6).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

Provide your response in JSON format with fields:
- answer: string (formatted with clean markdown, bullet points where appropriate)
- citations: array of strings (source references)
- suggestedFollowUps: array of 2-3 short conversational follow-up prompts
`;

  const aiRes = await generateWithModelFallback({
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: { type: Type.STRING },
          citations: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedFollowUps: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['answer', 'citations', 'suggestedFollowUps'],
      },
    },
  });

  const fallback = generateContextualCoachFallback(message, context, aiRes.errorReason);
  if (aiRes.text) {
    const parsed = safeParseJson(aiRes.text, fallback);
    if (parsed.parsedFromAi && parsed.value?.answer) {
      return {
        ...parsed.value,
        generationMode: 'gemini',
        aiNotice: `Generated live using ${aiRes.modelUsed || 'Gemini AI'}`,
      };
    }
  }

  return fallback;
}

/**
 * 4b. Real-Time Streaming AI Coach Conversation
 */
export async function coachChatStream(
  params: {
    message: string;
    conversationHistory: { role: string; content: string }[];
    context: {
      userName: string;
      targetRole?: string;
      targetCompany?: string;
      resumeText?: string;
      jdText?: string;
      analysis?: any;
      lastSessionReport?: any;
    };
  },
  callbacks: {
    onChunk: (chunk: string) => void;
  },
  abortSignal?: AbortSignal
): Promise<{
  fullText: string;
  answer: string;
  citations: string[];
  suggestedFollowUps: string[];
  generationMode: GenerationMode;
  aiNotice?: string;
}> {
  const { message, conversationHistory, context } = params;

  const systemInstruction = `You are "Personal AI Coach", a warm, intelligent, transparent AI mentor helping ${context.userName} prepare for their dream role (${context.targetRole || 'Software Engineer'} at ${context.targetCompany || 'Top Tech'}).
Be transparent that you are an AI assistant.
Answer in the language or dialect style the user speaks in (English, Hindi, or Hinglish) with clarity, depth, and practical guidance.
Ground your answers strictly in the candidate's verified resume, target JD, previous mock interview sessions, and preparation plan.
Never invent qualifications, numbers, or achievements.
Disclose uncertainty when information is missing and ask a focused follow-up question.
Offer clear, actionable, encouraging advice.
Format your response directly using clean, readable Markdown.`;

  const prompt = `User's question: "${message}"

CANDIDATE RESUME SUMMARY:
${context.resumeText ? context.resumeText.slice(0, 2500) : 'None uploaded'}

TARGET JOB DESCRIPTION:
${context.jdText ? context.jdText.slice(0, 2500) : 'None specified'}

RECENT INTERVIEW HIGHLIGHTS:
${context.lastSessionReport ? JSON.stringify(context.lastSessionReport).slice(0, 1500) : 'No sessions completed yet'}

CONVERSATION HISTORY:
${conversationHistory.slice(-6).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

INSTRUCTIONS:
Provide an immediate, well-structured, supportive answer in Markdown.
At the very end of your response, provide citations and suggested follow-ups formatted as:

---
CITATIONS:
- [Source reference 1]
- [Source reference 2]
FOLLOW_UPS:
- [Suggested follow-up prompt 1]
- [Suggested follow-up prompt 2]
- [Suggested follow-up prompt 3]
`;

  const ai = getGeminiClient();
  let hasStreamedAnyChunk = false;
  let accumulated = '';
  let modelUsed = '';
  let errorReason = !ai
    ? 'GEMINI_API_KEY is not configured in server environment; using context-aware local coaching engine.'
    : undefined;

  if (ai) {
    const models = getCandidateModels();
    for (const model of models) {
      if (abortSignal?.aborted) break;
      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents: prompt,
          config: { systemInstruction },
        });

        for await (const chunk of stream) {
          if (abortSignal?.aborted) break;
          const text = chunk.text;
          if (text) {
            hasStreamedAnyChunk = true;
            modelUsed = model;
            accumulated += text;
            callbacks.onChunk(text);
          }
        }

        if (hasStreamedAnyChunk) {
          break;
        }
      } catch (err: any) {
        const msg = String(err?.message || 'Stream error')
          .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]')
          .slice(0, 120);
        errorReason = `${model}: ${msg}`;
        console.warn(`Streaming attempt with model [${model}] failed:`, err?.status || msg);
        if (hasStreamedAnyChunk) break;
      }
    }
  }

  if (!hasStreamedAnyChunk) {
    const fallback = generateContextualCoachFallback(message, context, errorReason);
    const words = fallback.answer.split(' ');
    for (let i = 0; i < words.length; i += 4) {
      if (abortSignal?.aborted) break;
      const slice = words.slice(i, i + 4).join(' ') + (i + 4 < words.length ? ' ' : '');
      accumulated += slice;
      callbacks.onChunk(slice);
      await new Promise(r => setTimeout(r, 15));
    }

    return {
      fullText: fallback.answer,
      answer: fallback.answer,
      citations: fallback.citations,
      suggestedFollowUps: fallback.suggestedFollowUps,
      generationMode: 'fallback',
      aiNotice: fallback.aiNotice,
    };
  }

  let answer = accumulated;
  let citations: string[] = [];
  let suggestedFollowUps: string[] = [];

  const citationsMatch = accumulated.match(/\*{0,2}CITATIONS:?\*{0,2}\s*([\s\S]*?)(?:\*{0,2}(?:FOLLOW_UPS|SUGGESTIONS):?\*{0,2}|$)/i);
  if (citationsMatch && citationsMatch[1]) {
    citations = citationsMatch[1]
      .split('\n')
      .map(line => line.replace(/^[-*•\d.]\s*/, '').replace(/[\[\]]/g, '').trim())
      .filter(l => l.length > 0 && !l.startsWith('---') && l !== '*' && l !== '**')
      .slice(0, 4);
  }

  const followUpsMatch = accumulated.match(/\*{0,2}(?:FOLLOW_UPS|SUGGESTIONS):?\*{0,2}\s*([\s\S]*?)$/i);
  if (followUpsMatch && followUpsMatch[1]) {
    suggestedFollowUps = followUpsMatch[1]
      .split('\n')
      .map(line => line.replace(/^[-*•\d.]\s*/, '').replace(/^["']|["']$/g, '').trim())
      .filter(l => l.length > 0 && l !== '*' && l !== '**')
      .slice(0, 4);
  }

  answer = answer.replace(/\n*---\s*\n*\*{0,2}(?:CITATIONS|FOLLOW_UPS|SUGGESTIONS):?\*{0,2}[\s\S]*$/i, '').trim();
  answer = answer.replace(/\*{0,2}(?:CITATIONS|FOLLOW_UPS|SUGGESTIONS):?\*{0,2}[\s\S]*$/i, '').trim();

  if (citations.length === 0) {
    citations = [
      context.resumeText ? 'Candidate Verified Resume' : 'Personal AI Coach Framework',
      context.targetRole ? `Role Alignment: ${context.targetRole}` : 'Interview Preparation Standards',
    ];
  }

  if (suggestedFollowUps.length === 0) {
    const fallback = generateContextualCoachFallback(message, context);
    suggestedFollowUps = fallback.suggestedFollowUps;
  }

  return {
    fullText: accumulated,
    answer,
    citations,
    suggestedFollowUps,
    generationMode: 'gemini',
    aiNotice: `Streamed live using ${modelUsed || 'Gemini AI'}`,
  };
}

function generateContextualCoachFallback(
  message: string,
  context: {
    userName: string;
    targetRole?: string;
    targetCompany?: string;
    resumeText?: string;
    jdText?: string;
  },
  errorReason?: string
): {
  answer: string;
  citations: string[];
  suggestedFollowUps: string[];
  generationMode: GenerationMode;
  aiNotice: string;
} {
  const lower = message.toLowerCase().trim();
  const role = context.targetRole || 'Software Engineer';
  const company = context.targetCompany || 'Target Company';
  const detectedTechs = extractTechnologies(context.resumeText || '', context.jdText || '');
  const detectedProjects = extractResumeProjects(context.resumeText || '');
  const techSummary = detectedTechs.slice(0, 5).join(', ') || 'your core technical stack';
  const topProject = detectedProjects[0];

  const aiNotice =
    errorReason ||
    'Rule-based coaching engine active (Gemini API key unavailable). Guidance is grounded in your uploaded resume & JD.';

  // Hinglish / Hindi detection
  if (/kaise|kaha|shuru|karein|karu|batao|tips|madad|karna|tayari|kya|kyun|hindi/i.test(lower)) {
    return {
      answer: `Namaste ${context.userName}! Aapki **${role}** role at **${company}** ke liye tailored preparation strategy yeh hai:

1. **Resume & Core Fundamentals (${techSummary})**:
   - ${topProject ? `Apne resume project **"${topProject.name}"** ke architecture aur trade-offs ko detail mein ready karein.` : 'Apne resume ke top 2 projects ke architecture aur har technical choice ka "Why" prepare karein.'}
   - Core concepts (APIs, database optimization, concurrency, aur edge cases) revise karein.

2. **STAR Method for Behavioral Rounds**:
   - "Tell me about yourself" ko 90 seconds ke concise elevator pitch mein prepare karein.
   - Conflict resolution aur challenges ke liye real practical examples frame karein.

3. **Mock Interviews & Practice**:
   - Platform par teeno tracks (HR, Technical, Project Deep Dive) attempt karein aur 8-dimension rubric feedback dekhein.`,
      citations: [
        context.resumeText ? 'Uploaded Candidate Resume' : 'Coaching Framework',
        `Target Role: ${role}`,
      ],
      suggestedFollowUps: [
        '"Tell me about yourself" ka badhiya format kya hai?',
        `Top technical questions for ${detectedTechs[0] || role}`,
        'STAR method se conflict ka answer kaise dein?',
      ],
      generationMode: 'fallback',
      aiNotice,
    };
  }

  // Self-introduction
  if (/intro|introduce|tell me about yourself|self\b|elevator/i.test(lower)) {
    return {
      answer: `Hi ${context.userName}! Here is a tailored **Present → Past → Future** structure for **"Tell me about yourself"** targeting **${role}** at **${company}**:

1. **Present (30s)**: Highlight your active strengths in **${techSummary}** and your current engineering focus.
2. **Past (45s)**: ${topProject ? `Spotlight **"${topProject.name}"** from your resume (${topProject.technologies.join(', ') || techSummary}) along with measurable impact or technical complexity solved.` : 'Mention 1–2 concrete projects or engineering achievements from your resume with measurable outcomes.'}
3. **Future (15s)**: Connect your verified experience to **${company}**'s ${role} responsibilities.

**Pro-Tip**: Keep it under 90 seconds and end with a natural bridge into technical or project follow-ups.`,
      citations: [
        context.resumeText ? 'Candidate Resume Evidence' : 'Presentation Framework',
        `Role Match: ${role}`,
      ],
      suggestedFollowUps: [
        'How do I answer "What is your greatest weakness"?',
        'Help me prepare STAR behavioral stories',
        `Give me technical interview questions for ${detectedTechs[0] || role}`,
      ],
      generationMode: 'fallback',
      aiNotice,
    };
  }

  // Missing skills / gaps
  if (/missing|gap|weakness|strength|failure/i.test(lower)) {
    return {
      answer: `Here is how to address **skill gaps or weaknesses** truthfully without overclaiming:

- **Own the current boundary clearly**: State what you *have* shipped (**${techSummary}**) versus what you have limited production exposure to.
- **Bridge using adjacent experience**: Show how your experience ${topProject ? `on **"${topProject.name}"**` : 'in related systems'} transfers quickly.
- **Show concrete ramp-up action**: Share what hands-on prototype, documentation study, or benchmark you completed to close the gap.

Never fabricate years of experience with a tool you haven't used—interviewers test depth fast.`,
      citations: ['Truthful Evidence Policy', context.jdText ? 'Job Description Requirements' : 'Behavioral Rubric'],
      suggestedFollowUps: [
        'How should I discuss a project bug or failure?',
        'What architecture questions are most likely?',
        'Start HR Mock Interview',
      ],
      generationMode: 'fallback',
      aiNotice,
    };
  }

  // Project-specific coaching
  if (/project|portfolio|built|architecture|system design|trade-?off/i.test(lower)) {
    return {
      answer: topProject
        ? `Let's sharpen your walkthrough for **"${topProject.name}"** (${topProject.technologies.join(', ') || techSummary}):

1. **Problem Statement & Constraints**: What problem did it solve, and what scale/latency/data constraints existed?
2. **Architecture & Why These Tools**: Explain why you chose **${topProject.technologies.slice(0, 3).join(', ') || techSummary}** over alternatives.
3. **Hardest Bug / Bottleneck**: Walk through one real challenge (${topProject.description.slice(0, 140)}...) and how you verified the fix.
4. **Limitations & Next Version**: Mention 1–2 honest bottlenecks you'd improve in v2.`
        : `To structure any **System Design or Project** answer for **${role}** at **${company}**:

1. **Clarify Requirements & Scale** (functional + non-functional goals).
2. **Core Data Model & APIs** (schema, indexing, consistency).
3. **Architecture & Trade-Offs** (caching, queues, failure modes).
4. **Monitoring & Future Improvements**.

Upload your resume under **Resume & JD** so I can tailor this directly to your named projects!`,
      citations: [
        topProject ? `Resume Project: ${topProject.name}` : 'System Design Blueprint',
        `Detected Stack: ${techSummary}`,
      ],
      suggestedFollowUps: [
        'Quiz me on my project trade-offs',
        'How do I explain database scaling choices?',
        'What are common failure modes interviewers probe?',
      ],
      generationMode: 'fallback',
      aiNotice,
    };
  }

  // STAR / conflict
  if (/star|conflict|disagree|behavioral|situation|teamwork/i.test(lower)) {
    return {
      answer: `For behavioral & conflict questions at **${company}**, structure your story with **STAR**:

- **Situation (15%)**: Concise context from your real work history${topProject ? ` (for example during **${topProject.name}**)` : ''}.
- **Task (15%)**: The technical or team challenge you needed to resolve.
- **Action (50%)**: Focus on what **YOU** specifically did—gathering benchmarks/data, listening to stakeholders, and proposing an objective trade-off.
- **Result (20%)**: Quantifiable outcome and what you changed in your process afterward.`,
      citations: ['STAR Behavioral Framework', `Target Company: ${company}`],
      suggestedFollowUps: [
        'Give me an example STAR structure for tight deadlines',
        'How do I answer "Why should we hire you?"',
        'Practice HR Mock Interview',
      ],
      generationMode: 'fallback',
      aiNotice,
    };
  }

  return {
    answer: `Hi ${context.userName}! Here is tailored guidance for **"${message}"** targeting **${role}** at **${company}**:

- **Detected Resume & JD Context**: ${detectedTechs.length > 0 ? `**${techSummary}**` : 'General engineering skills'}${topProject ? ` • Key Project: **"${topProject.name}"**` : ''}
- **Interview Strategy**:
  1. Lead with a direct 1-sentence thesis before diving into technical details.
  2. Anchor claims in concrete examples from ${topProject ? `**"${topProject.name}"**` : 'your uploaded resume'}.
  3. Explicitly address trade-offs, edge cases, and measurable results.

Would you like to practice a specific question from your **${detectedTechs[0] || role}** stack right now?`,
    citations: [
      context.resumeText ? 'Candidate Uploaded Resume' : 'Coaching Framework',
      context.jdText ? 'Target Job Description' : `Role: ${role}`,
    ],
    suggestedFollowUps: [
      'How should I structure my "Tell me about yourself" answer?',
      topProject ? `Ask me tough follow-ups about ${topProject.name}` : 'What technical questions match my resume?',
      'How do I explain missing skills truthfully?',
    ],
    generationMode: 'fallback',
    aiNotice,
  };
}

// Resume- & JD-aware deterministic analyzer fallback
function fallbackAnalyze(
  resumeText: string,
  jdText: string,
  targetRole: string,
  targetCompany: string,
  detectedTechs: string[],
  detectedProjects: ExtractedProject[],
  errorReason?: string
): AnalysisOutput {
  const resumeTechs = extractTechnologies(resumeText, '');
  const jdTechs = extractTechnologies('', jdText);
  const requirementsMatchFromJd = extractJdRequirements(jdText, resumeText);

  const techRequirements = jdTechs.slice(0, 6).map(tech => {
    const inResume = resumeTechs.includes(tech);
    const matchingLine = resumeText
      .split('\n')
      .find(l => l.toLowerCase().includes(tech.split(/[\s/]/)[0].toLowerCase()))
      ?.trim();
    return {
      requirement: `Proficiency in ${tech}`,
      status: (inResume ? 'matched' : 'missing') as 'matched' | 'partial' | 'missing',
      evidence: inResume
        ? matchingLine
          ? `Resume excerpt: "${matchingLine.slice(0, 140)}"`
          : `Verified ${tech} experience in candidate resume.`
        : `No explicit mention of ${tech} detected in uploaded resume.`,
      importance: 'high' as const,
    };
  });

  const requirementsMatch =
    techRequirements.length >= 2
      ? techRequirements
      : requirementsMatchFromJd.length > 0
      ? requirementsMatchFromJd
      : [
          {
            requirement: `Core domain alignment for ${targetRole}`,
            status: resumeText.trim().length > 100 ? ('partial' as const) : ('missing' as const),
            evidence:
              resumeText.trim().length > 100
                ? `Resume uploaded (${resumeText.length} chars) with technologies: ${resumeTechs.join(', ') || 'general background'}.`
                : 'Resume content is too brief to assess full alignment.',
            importance: 'high' as const,
          },
        ];

  const matchedCount = requirementsMatch.filter(r => r.status === 'matched').length;
  const partialCount = requirementsMatch.filter(r => r.status === 'partial').length;
  const totalCount = Math.max(1, requirementsMatch.length);
  const computedScore = Math.min(
    96,
    Math.max(25, Math.round(((matchedCount + partialCount * 0.5) / totalCount) * 100))
  );

  const missingTechs = jdTechs.filter(t => !resumeTechs.includes(t));

  return {
    overallMatchScore: computedScore,
    profileSummary: `Uploaded resume demonstrates experience across ${
      resumeTechs.length > 0 ? resumeTechs.slice(0, 6).join(', ') : 'general engineering workflows'
    }${
      detectedProjects.length > 0 ? ` including project "${detectedProjects[0].name}"` : ''
    }. Evaluated against ${targetRole} requirements at ${targetCompany} with ${matchedCount}/${totalCount} direct matches.`,
    requirementsMatch,
    strengths: [
      resumeTechs.length > 0
        ? `Verified resume skills aligned with target role: ${resumeTechs.slice(0, 6).join(', ')}.`
        : 'Candidate resume successfully parsed and indexed for interview personalization.',
      detectedProjects.length > 0
        ? `Concrete project evidence found (${detectedProjects.map(p => p.name).slice(0, 2).join(', ')}) for Project Deep Dive mock interviews.`
        : 'Core experience bullets available for STAR behavioral story framing.',
    ],
    gaps: [
      ...(missingTechs.length > 0
        ? [`Job description mentions ${missingTechs.join(', ')}, which were not explicitly found in your resume.`]
        : ['Add quantifiable latency, throughput, reliability, or user-impact numbers where applicable.']),
      'Prepare explicit trade-off explanations and failure-mode mitigations for your main projects.',
    ],
    truthfulKeywordSuggestions:
      resumeTechs.length > 0
        ? resumeTechs.slice(0, 6)
        : ['System Architecture', 'Testing & Reliability', 'API Design'],
    likelyTopics: [
      ...detectedTechs.slice(0, 3).map(t => `${t} architecture, internals, and production trade-offs`),
      ...(detectedProjects[0]
        ? [`Deep Dive on "${detectedProjects[0].name}": architecture, bugs, and scaling limits`]
        : [`Behavioral STAR stories tailored to ${targetCompany}`]),
    ],
    studyPlan: [
      {
        day: 1,
        focus: `${targetCompany} Role Alignment`,
        task: `Review JD expectations for ${targetRole} and map each to your resume bullet points.`,
      },
      {
        day: 2,
        focus: `Core Stack Review (${resumeTechs[0] || 'Engineering'})`,
        task: `Drill core concepts and edge cases in ${resumeTechs.slice(0, 3).join(', ') || 'your primary stack'}.`,
      },
      {
        day: 3,
        focus: detectedProjects[0] ? `Project: ${detectedProjects[0].name}` : 'Project Architecture Deep Dive',
        task: `Prepare a 3-minute architecture walkthrough, key design trade-offs, and bug post-mortems.`,
      },
      {
        day: 4,
        focus: 'Technical Mock Practice',
        task: 'Complete Mock Track 2 (Technical) focusing on your target stack and JD requirements.',
      },
      {
        day: 5,
        focus: missingTechs[0] ? `Close Gap: ${missingTechs[0]}` : 'System Scalability & Edge Cases',
        task: missingTechs[0]
          ? `Study fundamentals and honest transferable analogies for ${missingTechs.join(', ')}.`
          : 'Practice designing for retries, concurrency, bottlenecks, and observability.',
      },
      {
        day: 6,
        focus: 'HR & STAR Behavioral Drill',
        task: 'Complete Mock Track 1 (HR) covering self-intro, conflict resolution, strengths/weaknesses.',
      },
      {
        day: 7,
        focus: 'Project Mock & Final Study Pack',
        task: 'Complete Mock Track 3 (Project Deep Dive) and export your PDF Study Pack.',
      },
    ],
    uncertaintyNotes: [
      errorReason || 'Analysis computed deterministically from your uploaded resume and job description text.',
      'Automated keyword matching checks exact skill presence; contextual seniority requires interviewer evaluation.',
    ],
    generationMode: 'fallback',
    aiNotice:
      errorReason ||
      'Rule-based evidence analyzer active (Gemini API key unavailable). Analysis uses your actual uploaded resume and JD.',
  };
}

function getTechQuestionBank(tech: string, targetRole: string, targetCompany: string): Omit<QuestionOutput, 'questionId' | 'generationMode' | 'aiNotice'>[] {
  const lower = tech.toLowerCase();
  if (lower.includes('python') || lower.includes('fastapi') || lower.includes('django')) {
    return [
      {
        questionText: `In Python backend services (${tech}) for a ${targetRole} role at ${targetCompany}, how do the GIL, multiprocessing, and asyncio differ, and when do you choose each?`,
        category: 'TECHNICAL',
        rationale: `Assesses Python concurrency fundamentals, async I/O vs CPU-bound execution, and production API performance.`,
        expectedSignals: ['GIL impact on CPU-bound threads', 'asyncio event loop for I/O concurrency', 'multiprocessing / worker pools for CPU tasks'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask how blocking calls inside an async FastAPI/asyncio route degrade throughput.',
      },
      {
        questionText: `How do you manage memory leaks, dependency isolation, and automated testing (pytest fixtures, mocking external APIs) in production Python applications?`,
        category: 'TECHNICAL',
        rationale: 'Evaluates Python production reliability, test hygiene, and lifecycle management.',
        expectedSignals: ['Reference counting + cyclic GC', 'Virtualenv/Poetry lockfiles', 'pytest fixtures & boundary mocking'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask about profiling slow Python endpoints in production.',
      },
    ];
  }
  if (lower.includes('java') || lower.includes('spring')) {
    return [
      {
        questionText: `In Java & Spring Boot services for ${targetCompany}, how do you tune JVM garbage collection, thread pools, and transactional boundaries (@Transactional) under heavy load?`,
        category: 'TECHNICAL',
        rationale: 'Evaluates JVM internals, Spring proxy transaction behavior, and resource contention.',
        expectedSignals: ['G1GC / ZGC pause behavior', '@Transactional proxy pitfalls (self-invocation)', 'Bounded connection/thread pools'],
        difficulty: 'advanced',
        followUpStrategy: 'Ask what happens when a checked exception is thrown inside @Transactional.',
      },
      {
        questionText: `Compare ConcurrentHashMap, synchronized blocks, and explicit ReentrantLocks in Java. Where can subtle deadlocks or memory visibility issues still arise?`,
        category: 'TECHNICAL',
        rationale: 'Tests Java concurrency model, happens-before guarantees, and lock contention.',
        expectedSignals: ['volatile visibility', 'CAS / bucket locking in ConcurrentHashMap', 'Consistent lock ordering'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask how CompletableFuture thread pools should be separated from ForkJoinPool.commonPool().',
      },
    ];
  }
  if (lower.includes('sql') || lower.includes('postgres')) {
    return [
      {
        questionText: `How do you diagnose slow SQL queries, design composite B-tree indexes, and choose transaction isolation levels (Read Committed vs Repeatable Read vs Serializable) in ${tech}?`,
        category: 'TECHNICAL',
        rationale: 'Tests relational database query planning, indexing selectivity, and concurrency anomalies.',
        expectedSignals: ['EXPLAIN ANALYZE / sequential vs index scan', 'Leftmost prefix rule in composite indexes', 'Row locking / SELECT FOR UPDATE'],
        difficulty: 'advanced',
        followUpStrategy: 'Ask about optimistic locking with version columns vs pessimistic locking.',
      },
    ];
  }
  if (lower.includes('react') || lower.includes('next')) {
    return [
      {
        questionText: `In ${tech}, how do you prevent unnecessary re-renders, manage async server-state synchronization vs local UI state, and avoid stale closures or race conditions during rapid user input?`,
        category: 'TECHNICAL',
        rationale: 'Evaluates React rendering lifecycle, AbortController cleanup, and state architecture.',
        expectedSignals: ['useEffect cleanup / AbortController for stale fetch races', 'Co-located state & memoization boundaries', 'Error boundaries & optimistic rollback'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask how they profile a sluggish React component tree using React DevTools.',
      },
    ];
  }
  if (lower.includes('ai') || lower.includes('ml')) {
    return [
      {
        questionText: `When building production ${tech} / LLM features for ${targetRole}, how do you design retrieval-augmented generation (RAG) chunking, guard against hallucinations, and evaluate answer quality deterministically?`,
        category: 'TECHNICAL',
        rationale: 'Tests practical AI/ML engineering: retrieval quality, grounding, latency, and evaluation harnesses.',
        expectedSignals: ['Chunking/embedding trade-offs & hybrid search', 'Strict grounding citations & refusal paths', 'Offline golden eval datasets + latency/cost budgets'],
        difficulty: 'advanced',
        followUpStrategy: 'Ask how they handle upstream LLM rate limits or schema-validation failures.',
      },
    ];
  }
  if (lower.includes('node') || lower.includes('typescript') || lower.includes('javascript')) {
    return [
      {
        questionText: `In ${tech} backend/full-stack services, how does the event loop prioritize microtasks vs macrotasks, and how do you avoid blocking the main thread while handling file parsing or heavy CPU work?`,
        category: 'TECHNICAL',
        rationale: 'Evaluates Node.js/TS runtime internals, non-blocking I/O, and worker offloading.',
        expectedSignals: ['Promise microtask queue vs timer/I/O phases', 'Worker Threads / child queues for CPU tasks', 'Stream backpressure'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask how unhandled promise rejections and graceful shutdown should be handled.',
      },
    ];
  }
  if (lower.includes('docker') || lower.includes('kubernetes') || lower.includes('aws')) {
    return [
      {
        questionText: `How do you design multi-stage container builds, zero-downtime rolling deployments, readiness/liveness probes, and secret injection in ${tech}?`,
        category: 'TECHNICAL',
        rationale: 'Tests deployment reliability, container security, and cloud operations.',
        expectedSignals: ['Minimal non-root image layers', 'Health vs readiness probe distinction', 'Externalized runtime secrets (never baked in images)'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask how to troubleshoot a pod stuck in CrashLoopBackOff or OOMKilled.',
      },
    ];
  }
  return [
    {
      questionText: `Focusing on ${tech} for a ${targetRole} position at ${targetCompany}, how do you design resilient APIs/components that handle concurrent requests, partial failures, and observability?`,
      category: 'TECHNICAL',
      rationale: `Evaluates practical ${tech} engineering depth, fault tolerance, and production monitoring.`,
      expectedSignals: [`Applied ${tech} design patterns`, 'Retries/timeouts & idempotency', 'Structured logging, metrics, and testing'],
      difficulty: 'intermediate',
      followUpStrategy: `Drill into how they tested failure paths when working with ${tech}.`,
    },
  ];
}

function fallbackQuestion(params: {
  sessionType: 'hr' | 'technical' | 'project_mixed';
  targetRole: string;
  targetCompany: string;
  sequenceNo: number;
  previousTurns: { question: string; answer: string }[];
  resumeText: string;
  jdText: string;
  focusTechnologies: string[];
  detectedProjects: ExtractedProject[];
  selectedProject?: string;
  errorReason?: string;
}): QuestionOutput {
  const {
    sessionType,
    targetRole,
    targetCompany,
    sequenceNo,
    focusTechnologies,
    detectedProjects,
    selectedProject,
    errorReason,
  } = params;

  const aiNotice =
    errorReason ||
    'Rule-based adaptive interviewer active (Gemini API key unavailable). Questions are tailored to your uploaded resume and selections.';

  if (sessionType === 'hr') {
    const hrBank: Omit<QuestionOutput, 'generationMode' | 'aiNotice'>[] = [
      {
        questionId: 'hr-q1',
        questionText: `To get started, tell me about yourself, your journey into ${targetRole}, and what specifically motivates you to apply to ${targetCompany}?`,
        category: 'HR',
        rationale: 'Assesses career narrative, role alignment, authentic company motivation, and clarity.',
        expectedSignals: ['Present-Past-Future structure', 'Genuine motivation for the role', 'Concise 90-second delivery'],
        difficulty: 'beginner',
        followUpStrategy: 'Explore why they are looking for their next challenge now.',
      },
      {
        questionId: 'hr-q2',
        questionText: 'What do you consider your strongest technical or collaborative strength, and what is one genuine area of weakness or growth you are actively improving?',
        category: 'HR',
        rationale: 'Evaluates self-awareness, honesty, and concrete growth habits.',
        expectedSignals: ['Specific strength backed by evidence', 'Authentic weakness (not a disguised brag)', 'Concrete mitigation steps'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask for a concrete example where that weakness affected a team deliverable.',
      },
      {
        questionId: 'hr-q3',
        questionText: 'Tell me about a time you had a strong disagreement with a teammate, manager, or stakeholder. How did you navigate the conflict and reach alignment?',
        category: 'SITUATIONAL',
        rationale: 'Evaluates conflict resolution, teamwork, empathy, and data-driven communication.',
        expectedSignals: ['STAR format', 'Respectful listening', 'Objective data/criteria over ego'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask what they learned and would repeat in future disagreements.',
      },
      {
        questionId: 'hr-q4',
        questionText: `Why should ${targetCompany} hire you for this ${targetRole} role over other strong candidates, and where do you see your career goals over the next 2–3 years?`,
        category: 'HR',
        rationale: 'Tests value proposition clarity and long-term career trajectory alignment.',
        expectedSignals: ['Alignment between strengths and team needs', 'Realistic growth ambition', 'Team-first mindset'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask what type of team environment brings out their best work.',
      },
      {
        questionId: 'hr-q5',
        questionText: 'Describe a situation where priorities shifted unexpectedly or a project fell behind schedule. How did you communicate with stakeholders and keep teamwork intact?',
        category: 'SITUATIONAL',
        rationale: 'Measures adaptability, transparent communication, and ownership under pressure.',
        expectedSignals: ['Early escalation', 'Pragmatic trade-offs', 'Post-mortem accountability'],
        difficulty: 'intermediate',
        followUpStrategy: 'Ask how they prevent similar schedule surprises earlier.',
      },
    ];
    const picked = hrBank[(sequenceNo - 1) % hrBank.length];
    return { ...picked, generationMode: 'fallback', aiNotice };
  }

  if (sessionType === 'technical') {
    const techs = focusTechnologies.length > 0 ? focusTechnologies : ['System Design', 'SQL / PostgreSQL', 'Node.js'];
    const bank: Omit<QuestionOutput, 'generationMode' | 'aiNotice'>[] = [];
    for (let i = 0; i < techs.length; i++) {
      const items = getTechQuestionBank(techs[i], targetRole, targetCompany);
      items.forEach((item, j) => {
        bank.push({
          ...item,
          questionId: `tech-${i}-${j}`,
        });
      });
    }
    const picked = bank[(sequenceNo - 1) % bank.length];
    return { ...picked, generationMode: 'fallback', aiNotice };
  }

  // Project Deep Dive (project_mixed)
  const orderedProjects = [...detectedProjects];
  if (selectedProject) {
    const idx = orderedProjects.findIndex(p => p.name.toLowerCase() === selectedProject.toLowerCase());
    if (idx > 0) {
      const [chosen] = orderedProjects.splice(idx, 1);
      orderedProjects.unshift(chosen);
    }
  }

  if (orderedProjects.length === 0) {
    const genericProj: Omit<QuestionOutput, 'generationMode' | 'aiNotice'>[] = [
      {
        questionId: 'proj-generic-1',
        questionText: 'No specific project list was found in an uploaded resume yet—walk me through the most impactful software project you have built. What was the problem statement, overall architecture, and tech stack?',
        category: 'PROJECT',
        rationale: 'Establishes concrete project context, problem ownership, and architectural clarity.',
        expectedSignals: ['Clear problem statement', 'Architecture diagram in words', 'Explicit tech choices'],
        difficulty: 'intermediate',
        followUpStrategy: 'Probe why they selected that database and backend framework.',
      },
      {
        questionId: 'proj-generic-2',
        questionText: 'In that project, what was the hardest bug, scaling bottleneck, or architectural limitation you encountered, and how would you redesign it today?',
        category: 'PROJECT',
        rationale: 'Evaluates debugging rigor, trade-off reflection, and honest awareness of limitations.',
        expectedSignals: ['Root cause analysis', 'Concrete fix & verification', 'Honest future improvements'],
        difficulty: 'advanced',
        followUpStrategy: 'Ask how deployment and testing were automated.',
      },
    ];
    return {
      ...genericProj[(sequenceNo - 1) % genericProj.length],
      generationMode: 'fallback',
      aiNotice,
    };
  }

  const projectBank: QuestionOutput[] = [];
  orderedProjects.forEach((proj, pIdx) => {
    const stackLabel = proj.technologies.length > 0 ? proj.technologies.join(', ') : 'the chosen tech stack';
    projectBank.push(
      {
        questionId: `proj-${pIdx}-arch`,
        questionText: `Let's dive into your resume project "${proj.name}" (${stackLabel}). What problem did it solve, how did the end-to-end architecture and workflow operate, and why did you choose ${proj.technologies[0] || 'this stack'} over alternatives?`,
        category: 'PROJECT',
        rationale: `Directly inspects "${proj.name}" from your resume: problem statement, architecture, and technology trade-offs.`,
        expectedSignals: ['Clear data & request workflow', 'Rationalized technology selection', 'Concrete component boundaries'],
        difficulty: 'intermediate',
        followUpStrategy: `Challenge database/API bottlenecks in "${proj.name}".`,
        generationMode: 'fallback',
        aiNotice,
      },
      {
        questionId: `proj-${pIdx}-bugs`,
        questionText: `Inside "${proj.name}", what was the trickiest bug, database/API challenge, or integration failure you ran into, how did you debug the root cause, and what changed in your code afterward?`,
        category: 'PROJECT',
        rationale: `Tests real engineering troubleshooting and code ownership inside "${proj.name}".`,
        expectedSignals: ['Reproducible debugging steps', 'Root cause vs symptom fix', 'Tests/guardrails added'],
        difficulty: 'advanced',
        followUpStrategy: `Ask about deployment, monitoring, or edge cases in "${proj.name}".`,
        generationMode: 'fallback',
        aiNotice,
      },
      {
        questionId: `proj-${pIdx}-scale`,
        questionText: `If "${proj.name}" grew 10x in users or data volume tomorrow, what are its current limitations, deployment constraints, and the top architectural improvements you would prioritize first?`,
        category: 'PROJECT',
        rationale: `Evaluates forward-looking systems thinking, deployment maturity, and honest limitation awareness for "${proj.name}".`,
        expectedSignals: ['Identified bottlenecks (DB, I/O, state)', 'Pragmatic deployment & caching strategy', 'Clear future roadmap'],
        difficulty: 'advanced',
        followUpStrategy: 'Probe trade-offs of the proposed v2 improvements.',
        generationMode: 'fallback',
        aiNotice,
      }
    );
  });

  // Interleave across projects so Q1 covers Project 1 architecture, Q2 either Project 1 challenges or Project 2 depending on sequence
  return projectBank[(sequenceNo - 1) % projectBank.length];
}

function fallbackFeedback(
  question: string,
  answer: string,
  resumeText = '',
  errorReason?: string
): FeedbackOutput {
  const trimmed = answer.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const hasReasoning = /because|therefore|trade-?off|since|whereas|however|instead|latency|throughput|index|cache|async|lock|test|error/i.test(trimmed);
  const hasStarOrStructure = /situation|task|action|result|first|second|finally|specifically|implemented|built|designed|reduced|improved|measured/i.test(trimmed);
  const hasMetricsOrNumbers = /\d+%|\d+ms|\d+s\b|\d+x\b|\d+\s*(?:rps|qps|users|mb|gb|years|hours|minutes)/i.test(trimmed);

  // Check overlap with question terms
  const qKeywords = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !['could', 'would', 'about', 'which', 'where', 'their', 'there', 'explain', 'describe', 'please'].includes(w));
  const lowerAns = trimmed.toLowerCase();
  const overlapCount = qKeywords.filter(k => lowerAns.includes(k)).length;

  const projects = extractResumeProjects(resumeText);
  const citesProject =
    projects.some(p => lowerAns.includes(p.name.toLowerCase().split(' ')[0])) ||
    /project|at my previous|in my app|in our service|resume/i.test(trimmed);

  // Honest scoring calibrated to actual answer depth
  let base = 2.0;
  if (wordCount >= 12) base += 0.6;
  if (wordCount >= 30) base += 0.8;
  if (wordCount >= 60) base += 0.5;
  if (hasReasoning) base += 0.4;
  if (hasStarOrStructure) base += 0.3;
  if (overlapCount >= 2) base += 0.3;
  const clamp = (v: number) => Number(Math.max(1.0, Math.min(5.0, v)).toFixed(1));

  const technicalCorrectness = clamp(base + (hasReasoning ? 0.3 : -0.3));
  const relevance = clamp(overlapCount >= 1 || wordCount >= 15 ? base + 0.3 : 1.5);
  const completeness = clamp(wordCount >= 55 ? base + 0.2 : wordCount >= 20 ? base - 0.3 : 1.5);
  const structure = clamp(hasStarOrStructure ? base + 0.4 : wordCount >= 25 ? base - 0.1 : 1.6);
  const communicationClarity = clamp(wordCount >= 15 ? base + 0.2 : 2.0);
  const grammarVocabulary = clamp(wordCount >= 10 && /[A-Z]/.test(trimmed) ? base + 0.3 : 2.5);
  const conciseness = clamp(wordCount > 260 ? 3.2 : wordCount >= 20 ? 4.3 : 2.2);
  const projectEvidence = clamp(citesProject || hasMetricsOrNumbers ? base + 0.4 : base - 0.4);

  const whatWorked: string[] = [];
  if (wordCount >= 25) whatWorked.push('Provided sufficient explanation rather than a one-line response.');
  if (hasReasoning) whatWorked.push('Explained reasoning, trade-offs, or concrete technical mechanisms.');
  if (hasStarOrStructure) whatWorked.push('Demonstrated clear sequence/STAR framing in the response.');
  if (citesProject || hasMetricsOrNumbers) whatWorked.push('Anchored claims with project context or concrete metrics.');
  if (whatWorked.length === 0) {
    whatWorked.push('Submitted an initial response to engage with the prompt.');
  }

  const missingPoints: string[] = [];
  if (wordCount < 35) missingPoints.push('Answer is brief—expand on how you implemented the solution and why alternatives were rejected.');
  if (!hasReasoning) missingPoints.push('Explicitly state engineering trade-offs, edge cases, or root causes.');
  if (!hasMetricsOrNumbers && !citesProject) missingPoints.push('Ground your answer in a concrete resume project and quantifiable outcomes.');

  return {
    scores: {
      technicalCorrectness,
      relevance,
      completeness,
      structure,
      communicationClarity,
      grammarVocabulary,
      conciseness,
      projectEvidence,
    },
    whatWorked,
    missingPoints,
    technicalCorrections:
      wordCount < 15
        ? ['A complete interview response needs technical mechanisms or concrete STAR actions rather than a short phrase.']
        : [],
    grammarSuggestions:
      wordCount >= 8 && !/[.!?]$/.test(trimmed)
        ? ['Conclude with a clear closing sentence summarizing the final outcome or impact.']
        : [],
    improvedAnswer: `Lead with a crisp 1-sentence direct answer to "${question.slice(0, 90)}...", explain 2 concrete design or behavioral actions you took (and their trade-offs), cite evidence from ${
      projects[0] ? `your "${projects[0].name}" project` : 'a real project on your resume'
    }, and close with the measurable result.`,
    practiceTask:
      'Practice delivering this answer out loud in 60–90 seconds hitting: 1. Context, 2. Your Concrete Action/Trade-off, 3. Measurable Outcome.',
    suggestedFollowUp:
      'What edge cases, monitoring metrics, or failure modes did you verify after implementing this?',
    generationMode: 'fallback',
    aiNotice:
      errorReason ||
      'Rule-based rubric evaluator active (Gemini API key unavailable).',
  };
}
