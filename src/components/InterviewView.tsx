import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Sparkles,
  Award,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
  Clock,
  Send,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  FileText,
  Info,
  FolderGit2,
  Code2,
} from 'lucide-react';
import { api } from '../api';
import type {
  User,
  InterviewSession,
  InterviewTurn,
  FeedbackData,
  FinalReport,
  InterviewContextInfo,
} from '../types';

interface InterviewViewProps {
  user: User;
  initialTrack?: 'hr' | 'technical' | 'project_mixed';
  initialSessionId?: string;
  initialAnalysisId?: string;
  onNavigate: (tab: string, state?: any) => void;
}

const RUBRIC_LABELS: Record<string, string> = {
  technicalCorrectness: 'Technical Correctness',
  relevance: 'Relevance',
  completeness: 'Completeness',
  structure: 'Structure',
  communicationClarity: 'Communication Clarity',
  grammarVocabulary: 'Grammar & Vocabulary',
  conciseness: 'Conciseness',
  projectEvidence: 'Project Evidence',
};

export const InterviewView: React.FC<InterviewViewProps> = ({
  user,
  initialTrack = 'technical',
  initialSessionId,
  initialAnalysisId,
  onNavigate,
}) => {
  // Pre-session context (uploaded resume, JD, detected technologies & projects)
  const [contextInfo, setContextInfo] = useState<InterviewContextInfo | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');

  // Session State
  const [selectedTrack, setSelectedTrack] = useState<'hr' | 'technical' | 'project_mixed'>(initialTrack);
  const [activeSession, setActiveSession] = useState<InterviewSession | null>(null);
  const [turns, setTurns] = useState<InterviewTurn[]>([]);
  const [viewIndex, setViewIndex] = useState<number>(0);

  // Loading & error states
  const [startingTrack, setStartingTrack] = useState<'hr' | 'technical' | 'project_mixed' | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Input & Mode States
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [answerText, setAnswerText] = useState('');
  const [transcriptEdited, setTranscriptEdited] = useState(false);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);

  // Feedback & Final Report State
  const [latestFeedback, setLatestFeedback] = useState<{ turnSeq: number; data: FeedbackData } | null>(null);
  const [finalReport, setFinalReport] = useState<FinalReport | null>(null);

  // Timer State (20 minutes = 1200 seconds)
  const [secondsRemaining, setSecondsRemaining] = useState(1200);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const autoEndedRef = useRef(false);

  // Voice Recognition & TTS State
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Fetch interview context on mount & when returning to track selection
  const loadContext = async () => {
    setLoadingContext(true);
    try {
      const ctx = await api.getInterviewContext();
      setContextInfo(ctx);
      if (ctx.detectedTechnologies && ctx.detectedTechnologies.length > 0) {
        setSelectedTechs((prev) => (prev.length > 0 ? prev : ctx.detectedTechnologies.slice(0, 5)));
      }
    } catch {
      // Context fetch failure should not block starting an interview
    } finally {
      setLoadingContext(false);
    }
  };

  useEffect(() => {
    loadContext();
  }, []);

  // Check speech recognition support
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recog = new SpeechRecognition();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = 'en-US';

      recog.onresult = (event: any) => {
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalChunk += event.results[i][0].transcript + ' ';
          }
        }
        if (finalChunk.trim()) {
          setAnswerText((prev) => (prev ? `${prev.trim()} ${finalChunk.trim()}` : finalChunk.trim()));
        }
      };

      recog.onerror = () => setIsListening(false);
      recog.onend = () => setIsListening(false);
      recognitionRef.current = recog;
    }
    return () => {
      try {
        recognitionRef.current?.stop();
        window.speechSynthesis?.cancel();
      } catch {}
    };
  }, []);

  // Load existing session if initialSessionId is passed
  useEffect(() => {
    if (!initialSessionId) return;
    let cancelled = false;
    setLoadingSession(true);
    setError(null);

    api
      .getInterview(initialSessionId)
      .then((res) => {
        if (cancelled) return;
        setActiveSession(res.session);
        setTurns(res.turns || []);
        setViewIndex(Math.max(0, (res.turns?.length || 1) - 1));
        setSelectedTrack(res.session.session_type);

        if (res.session.finalReport) {
          setFinalReport(res.session.finalReport);
        } else {
          setFinalReport(null);
          const startedAt = new Date(res.session.started_at || res.session.created_at).getTime();
          const elapsed = Number.isFinite(startedAt)
            ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
            : 0;
          const target = res.session.target_duration_seconds || 1200;
          setSecondsRemaining(Math.max(60, target - elapsed));

          const lastEvaluated = [...(res.turns || [])].reverse().find((t) => t.feedback);
          if (lastEvaluated?.feedback) {
            setLatestFeedback({ turnSeq: lastEvaluated.sequenceNo, data: lastEvaluated.feedback });
          }
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError('Could not load interview session: ' + (err.message || 'Unknown error'));
      })
      .finally(() => {
        if (!cancelled) setLoadingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialSessionId]);

  // Countdown timer effect
  useEffect(() => {
    if (!activeSession || finalReport) return;
    const interval = setInterval(() => {
      if (isPaused) {
        setPausedSeconds((p) => p + 1);
      } else {
        setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSession, isPaused, finalReport]);

  // Auto-end gracefully if timer reaches 0 (never inside setState updater)
  useEffect(() => {
    if (activeSession && !finalReport && secondsRemaining === 0 && !autoEndedRef.current) {
      autoEndedRef.current = true;
      handleEndInterview();
    }
  }, [secondsRemaining, activeSession, finalReport]);

  const toggleTechSelection = (tech: string) => {
    setSelectedTechs((prev) =>
      prev.includes(tech) ? prev.filter((t) => t !== tech) : [...prev, tech]
    );
  };

  const handleStartSession = async (track: 'hr' | 'technical' | 'project_mixed') => {
    setError(null);
    setSelectedTrack(track);
    setStartingTrack(track);
    setLatestFeedback(null);
    setFinalReport(null);
    setAnswerText('');
    setTranscriptEdited(false);
    setPausedSeconds(0);
    setSecondsRemaining(1200);
    setIsPaused(false);
    autoEndedRef.current = false;

    try {
      const res = await api.startInterview({
        analysisId: initialAnalysisId || contextInfo?.latestAnalysisId || undefined,
        type: track,
        targetDurationMinutes: 20,
        mode: inputMode,
        focusTechnologies: track === 'technical' ? selectedTechs : undefined,
        selectedProject: track === 'project_mixed' && selectedProject ? selectedProject : undefined,
      });

      const newSession: InterviewSession = {
        id: res.sessionId,
        session_type: track,
        mode: inputMode,
        status: 'in_progress',
        target_duration_seconds: res.targetDurationSeconds,
        duration_seconds: 0,
        ended_early: false,
        started_at: new Date().toISOString(),
        ended_at: null,
        created_at: new Date().toISOString(),
      };

      const initialTurn: InterviewTurn = {
        id: res.currentTurn.turnId,
        sequenceNo: res.currentTurn.sequenceNo,
        questionText: res.currentTurn.question,
        questionCategory: res.currentTurn.category,
        rationale: res.currentTurn.rationale,
        difficulty: res.currentTurn.difficulty,
        generationMode: res.currentTurn.generationMode,
        aiNotice: res.currentTurn.aiNotice,
        askedAt: new Date().toISOString(),
      };

      setActiveSession(newSession);
      setTurns([initialTurn]);
      setViewIndex(0);
    } catch (err: any) {
      setError('Could not start mock interview: ' + (err.message || 'Please check your connection and try again.'));
    } finally {
      setStartingTrack(null);
    }
  };

  const handleToggleVoice = () => {
    if (!speechSupported) {
      setError('Web Speech Recognition is not supported in this browser. Please type your response.');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  };

  const viewedTurn = turns[viewIndex] || null;
  const activeTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const isViewingCurrentActiveTurn =
    Boolean(viewedTurn && activeTurn && viewedTurn.id === activeTurn.id && !activeTurn.answerText);

  const handleSpeakQuestion = () => {
    if (!('speechSynthesis' in window) || !viewedTurn) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else {
      const utterance = new SpeechSynthesisUtterance(viewedTurn.questionText);
      utterance.rate = 1.0;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
      setIsSpeaking(true);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!activeSession || !activeTurn || !answerText.trim() || submittingAnswer) return;
    setError(null);
    setSubmittingAnswer(true);

    try {
      if (isListening) {
        recognitionRef.current?.stop();
        setIsListening(false);
      }

      const submittedAnswer = answerText.trim();
      const res = await api.submitAnswer(activeSession.id, {
        turnId: activeTurn.id,
        answerText: submittedAnswer,
        transcriptEdited,
      });

      const nextTurnObj: InterviewTurn = {
        id: res.nextTurn.turnId,
        sequenceNo: res.nextTurn.sequenceNo,
        questionText: res.nextTurn.question,
        questionCategory: res.nextTurn.category,
        rationale: res.nextTurn.rationale,
        difficulty: res.nextTurn.difficulty,
        generationMode: res.nextTurn.generationMode,
        aiNotice: res.nextTurn.aiNotice,
        askedAt: new Date().toISOString(),
      };

      setTurns((prev) => {
        const updated = prev.map((t) =>
          t.id === activeTurn.id
            ? {
                ...t,
                answerText: submittedAnswer,
                transcriptEdited,
                feedback: res.feedback,
                answeredAt: new Date().toISOString(),
              }
            : t
        );
        return [...updated, nextTurnObj];
      });

      setViewIndex((prevLen) => {
        void prevLen;
        return turns.length; // points to newly appended nextTurnObj
      });

      setLatestFeedback({ turnSeq: activeTurn.sequenceNo, data: res.feedback });
      setAnswerText('');
      setTranscriptEdited(false);
    } catch (err: any) {
      setError('Answer submission failed: ' + (err.message || 'Please retry.'));
    } finally {
      setSubmittingAnswer(false);
    }
  };

  const handleEndInterview = async () => {
    if (!activeSession || endingSession) return;
    setError(null);
    setEndingSession(true);
    setConfirmEndOpen(false);
    try {
      const res = await api.endInterview(activeSession.id, pausedSeconds);
      setFinalReport(res.report);
      setActiveSession((prev) => (prev ? { ...prev, status: 'completed', finalReport: res.report } : prev));
    } catch (err: any) {
      setError('Error concluding interview session: ' + (err.message || 'Please retry.'));
    } finally {
      setEndingSession(false);
    }
  };

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const answeredCount = turns.filter((t) => Boolean(t.answerText)).length;
  const displayFeedback: { turnSeq: number; data: FeedbackData } | null =
    viewedTurn?.feedback
      ? { turnSeq: viewedTurn.sequenceNo, data: viewedTurn.feedback }
      : isViewingCurrentActiveTurn
      ? latestFeedback
      : null;

  const techOptions = Array.from(
    new Set([
      ...(contextInfo?.detectedTechnologies || []),
      ...(contextInfo?.availableTechOptions || ['TypeScript', 'React', 'Node.js', 'Python', 'Java', 'SQL / PostgreSQL', 'System Design', 'AI / ML']),
    ])
  ).slice(0, 12);

  return (
    <div className="space-y-8 animate-fadeIn pb-16">
      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-[11px] font-semibold text-rose-300 hover:text-white underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {loadingSession && (
        <div className="glass-panel-3d p-12 rounded-3xl border border-slate-800/90 text-center space-y-3">
          <RefreshCw className="w-7 h-7 text-cyan-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-300 font-semibold">Loading interview session...</p>
        </div>
      )}

      {/* Track Selection Header (when no active interview) */}
      {!loadingSession && !activeSession && !finalReport && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-950/80 border border-violet-500/40 text-violet-300 text-xs font-semibold uppercase tracking-wider mb-2 shadow-inner">
                <Mic className="w-3.5 h-3.5 text-cyan-400" />
                <span>Realistic Interview Simulation</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Select Your 20-Minute Mock Interview Track
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">
                Each track personalizes questions from your uploaded resume and job description with adaptive follow-ups and 8-dimension rubric feedback.
              </p>
            </div>

            {/* Answer Mode Toggle */}
            <div className="inline-flex items-center p-1 rounded-xl bg-slate-950/80 border border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => setInputMode('text')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  inputMode === 'text' ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Text Mode
              </button>
              <button
                type="button"
                onClick={() => setInputMode('voice')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  inputMode === 'voice' ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Voice + Text
              </button>
            </div>
          </div>

          {/* Grounded Context Banner */}
          <div className="glass-panel-3d p-4 sm:p-5 rounded-2xl border border-slate-800/90 border-t-white/[0.1] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <FileText className={`w-4 h-4 ${contextInfo?.resumeLoaded ? 'text-emerald-400' : 'text-amber-400'}`} />
                <span className="text-slate-300">
                  Resume:{' '}
                  {loadingContext ? (
                    <span className="text-slate-500">Checking...</span>
                  ) : contextInfo?.resumeLoaded ? (
                    <strong className="text-white">{contextInfo.resumeFilename} ({contextInfo.resumeCharCount} chars)</strong>
                  ) : (
                    <span className="text-amber-300">Not uploaded yet</span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <FileText className={`w-4 h-4 ${contextInfo?.jdLoaded ? 'text-cyan-400' : 'text-amber-400'}`} />
                <span className="text-slate-300">
                  Job Description:{' '}
                  {loadingContext ? (
                    <span className="text-slate-500">Checking...</span>
                  ) : contextInfo?.jdLoaded ? (
                    <strong className="text-white">{contextInfo.jdFilename} ({contextInfo.jdCharCount} chars)</strong>
                  ) : (
                    <span className="text-amber-300">Not uploaded yet</span>
                  )}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('analysis')}
              className="btn-3d-secondary px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer shrink-0"
            >
              {contextInfo?.resumeLoaded && contextInfo?.jdLoaded ? 'Update Resume / JD' : 'Upload Resume & JD →'}
            </button>
          </div>

          {contextInfo && !contextInfo.aiConfigured && (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-200 text-xs flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Live Gemini API key is not configured on the server; questions and rubric feedback use the built-in resume-aware fallback engine. All interview progress, history, and 8-dimension scoring remain fully active.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Mock 1: HR */}
            <div className={`glass-panel-3d card-3d-hover rounded-2xl p-6 border flex flex-col justify-between shadow-xl relative overflow-hidden ${
              selectedTrack === 'hr' ? 'border-indigo-400/70' : 'border-slate-800/90 border-t-white/[0.12]'
            }`}>
              <div className="absolute top-0 right-0 w-28 h-28 bg-indigo-600/10 rounded-full blur-2xl pointer-events-none" />
              <div>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-950/90 text-indigo-300 font-bold uppercase tracking-wider border border-indigo-700/50 shadow-inner">
                  Track 1
                </span>
                <h3 className="text-base font-bold text-white mt-3 mb-2">HR & Behavioral</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  Evaluates your self-introduction, career motivations, STAR situational stories, teamwork, conflict management, and company alignment.
                </p>
                <div className="text-[11px] text-slate-300 space-y-2 border-t border-slate-800/80 pt-3 mb-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span>STAR Structure & Ownership</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Tailored to {contextInfo?.targetCompany || user.target_company || 'Target Company'}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                disabled={startingTrack !== null}
                onClick={() => handleStartSession('hr')}
                className="w-full btn-3d-secondary py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {startingTrack === 'hr' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Starting HR Track...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Start HR Track</span>
                  </>
                )}
              </button>
            </div>

            {/* Mock 2: Technical + Technology Focus Selector */}
            <div className={`glass-panel-3d card-3d-hover rounded-2xl p-6 border bg-gradient-to-b from-slate-900/95 via-indigo-950/50 to-slate-950/95 flex flex-col justify-between shadow-2xl relative overflow-hidden ${
              selectedTrack === 'technical' ? 'border-cyan-400/80' : 'border-cyan-500/40 border-t-white/[0.18]'
            }`}>
              <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/15 rounded-full blur-2xl pointer-events-none" />
              <div>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-cyan-950/90 text-cyan-300 font-bold uppercase tracking-wider border border-cyan-600/50 shadow-inner">
                  Track 2 • Technical
                </span>
                <h3 className="text-base font-bold text-white mt-3 mb-2">Technical & Architecture</h3>
                <p className="text-xs text-slate-300/90 leading-relaxed mb-3">
                  Adapts questions to your resume stack and JD requirements. Choose focus technologies below:
                </p>

                {/* Focus Technology Selector */}
                <div className="mb-4 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-300 uppercase tracking-wider mb-2">
                    <Code2 className="w-3 h-3" />
                    <span>Focus Technologies ({selectedTechs.length} selected)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {techOptions.map((tech) => {
                      const active = selectedTechs.includes(tech);
                      return (
                        <button
                          key={tech}
                          type="button"
                          onClick={() => toggleTechSelection(tech)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-all cursor-pointer ${
                            active
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {tech}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <button
                type="button"
                disabled={startingTrack !== null}
                onClick={() => handleStartSession('technical')}
                className="w-full btn-3d-primary py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {startingTrack === 'technical' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Starting Technical Track...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Start Technical Track</span>
                  </>
                )}
              </button>
            </div>

            {/* Mock 3: Project Deep Dive + Detected Projects */}
            <div className={`glass-panel-3d card-3d-hover rounded-2xl p-6 border flex flex-col justify-between shadow-xl relative overflow-hidden ${
              selectedTrack === 'project_mixed' ? 'border-violet-400/70' : 'border-slate-800/90 border-t-white/[0.12]'
            }`}>
              <div className="absolute top-0 right-0 w-28 h-28 bg-violet-600/10 rounded-full blur-2xl pointer-events-none" />
              <div>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-violet-950/90 text-violet-300 font-bold uppercase tracking-wider border border-violet-700/50 shadow-inner">
                  Track 3
                </span>
                <h3 className="text-base font-bold text-white mt-3 mb-2">Project Deep Dive</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">
                  Targets the projects found on your uploaded resume: architecture choices, bottlenecks, debugging, and measurable impact.
                </p>

                {/* Detected Projects Selector */}
                <div className="mb-4 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-violet-300 uppercase tracking-wider">
                    <FolderGit2 className="w-3 h-3" />
                    <span>Resume Projects</span>
                  </div>
                  {contextInfo?.detectedProjects && contextInfo.detectedProjects.length > 0 ? (
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedProject('')}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] border cursor-pointer transition-all ${
                          selectedProject === ''
                            ? 'bg-violet-600/20 border-violet-400 text-white font-semibold'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Adaptive across all {contextInfo.detectedProjects.length} detected projects
                      </button>
                      {contextInfo.detectedProjects.slice(0, 3).map((proj, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedProject(proj.name)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] border cursor-pointer transition-all ${
                            selectedProject === proj.name
                              ? 'bg-violet-600/20 border-violet-400 text-white font-semibold'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <div className="truncate font-medium">{proj.name}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      {contextInfo?.resumeLoaded
                        ? 'Will evaluate your core work history and technical initiatives.'
                        : 'Upload your resume first to extract specific projects.'}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                disabled={startingTrack !== null}
                onClick={() => handleStartSession('project_mixed')}
                className="w-full btn-3d-secondary py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {startingTrack === 'project_mixed' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Starting Project Track...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Start Project Track</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Interview Arena */}
      {!loadingSession && activeSession && !finalReport && viewedTurn && (
        <div className="space-y-6">
          {/* Header Status Bar */}
          <div className="glass-panel-3d p-4 rounded-2xl border border-slate-800/90 border-t-white/[0.12] flex flex-wrap items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
              <div>
                <span className="text-xs font-bold text-white capitalize">
                  {activeSession.session_type === 'hr'
                    ? 'Track 1: HR & Behavioral'
                    : activeSession.session_type === 'technical'
                    ? 'Track 2: Technical & Architecture'
                    : 'Track 3: Resume Project Deep Dive'}
                </span>
                <span className="text-slate-500 text-xs mx-2">•</span>
                <span className="text-xs text-cyan-400 font-semibold">
                  Question #{viewedTurn.sequenceNo} ({answeredCount} answered)
                </span>
              </div>
            </div>

            {/* Timer & Controls */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-slate-800 font-mono text-xs font-bold text-cyan-300 shadow-inner">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>{formatTimer(secondsRemaining)}</span>
                {isPaused && <span className="text-[10px] text-amber-400 ml-1">PAUSED</span>}
              </div>

              <button
                type="button"
                onClick={() => setIsPaused(!isPaused)}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shadow-sm"
                title={isPaused ? 'Resume interview' : 'Pause interview'}
                aria-label={isPaused ? 'Resume interview' : 'Pause interview'}
              >
                {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
              </button>

              <button
                type="button"
                onClick={() => setConfirmEndOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-300 hover:bg-rose-900/50 text-xs font-semibold transition-colors cursor-pointer"
              >
                End Session
              </button>
            </div>
          </div>

          {/* Question Navigation Strip */}
          {turns.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800/90">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-400 font-semibold mr-1">Questions:</span>
                {turns.map((t, idx) => {
                  const isCurrentView = idx === viewIndex;
                  const isDone = Boolean(t.answerText);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setViewIndex(idx)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer border ${
                        isCurrentView
                          ? 'bg-violet-600 text-white border-violet-400 shadow'
                          : isDone
                          ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/50'
                          : 'bg-slate-900 text-cyan-300 border-cyan-700/50 hover:bg-slate-800'
                      }`}
                    >
                      Q{t.sequenceNo} {isDone ? '✓' : '•'}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={viewIndex === 0}
                  onClick={() => setViewIndex((i) => Math.max(0, i - 1))}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 cursor-pointer"
                  aria-label="Previous question"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={viewIndex >= turns.length - 1}
                  onClick={() => setViewIndex((i) => Math.min(turns.length - 1, i + 1))}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 cursor-pointer"
                  aria-label="Next question"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {viewedTurn.aiNotice && (
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-200 text-[11px] flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{viewedTurn.aiNotice}</span>
            </div>
          )}

          {/* Question Display Card */}
          <div className="glass-panel-3d p-6 sm:p-8 rounded-3xl border border-violet-500/40 border-t-white/[0.18] bg-gradient-to-br from-slate-900/95 via-indigo-950/50 to-slate-900/95 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-violet-600/30 text-cyan-300 border border-violet-500/40 shadow-inner">
                    {viewedTurn.questionCategory}
                  </span>
                  {viewedTurn.difficulty && (
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                      {viewedTurn.difficulty} Level
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSpeakQuestion}
                  className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer font-semibold transition-colors"
                >
                  {isSpeaking ? <VolumeX className="w-4 h-4 text-rose-400 animate-pulse" /> : <Volume2 className="w-4 h-4" />}
                  <span className="hidden sm:inline">{isSpeaking ? 'Stop Audio' : 'Read Aloud'}</span>
                </button>
              </div>

              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-relaxed">
                "{viewedTurn.questionText}"
              </h2>

              {viewedTurn.rationale && (
                <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-slate-800/80">
                  <strong className="text-slate-300 font-semibold">Interviewer Intent:</strong> {viewedTurn.rationale}
                </p>
              )}
            </div>
          </div>

          {/* Either show Answer Composer (if active unanswered turn) OR show Candidate's Saved Answer (if reviewing previous turn) */}
          {isViewingCurrentActiveTurn ? (
            <div className="glass-panel-3d p-6 rounded-2xl border border-slate-800/90 border-t-white/[0.12] space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-white">Your Response</span>
                  {speechSupported && (
                    <button
                      type="button"
                      onClick={handleToggleVoice}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                        isListening
                          ? 'bg-rose-950 text-rose-300 border border-rose-800 animate-pulse shadow-md shadow-rose-950/50'
                          : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-cyan-400" />}
                      <span>{isListening ? 'Stop Recording' : 'Speak Answer'}</span>
                    </button>
                  )}
                </div>

                <div className="text-[11px] text-slate-400 font-medium">
                  {answerText.trim().split(/\s+/).filter(Boolean).length} words
                </div>
              </div>

              <textarea
                rows={6}
                value={answerText}
                onChange={(e) => {
                  setAnswerText(e.target.value);
                  setTranscriptEdited(true);
                }}
                placeholder={
                  isListening
                    ? 'Listening... Speak naturally. You can edit the transcribed text before submitting.'
                    : 'Type your answer here, or click "Speak Answer" to use microphone input...'
                }
                className="input-3d w-full p-4 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none"
              />

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <span className="text-[11px] text-slate-400">
                  Tip: Use STAR structure for behavioral questions. Quantify architecture trade-offs for technical questions.
                </span>

                <button
                  type="button"
                  onClick={handleSubmitAnswer}
                  disabled={submittingAnswer || !answerText.trim()}
                  className="w-full sm:w-auto btn-3d-primary px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {submittingAnswer ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Evaluating Rubric...</span>
                    </>
                  ) : (
                    <>
                      <span>Submit For Evaluation</span>
                      <Send className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="glass-panel-3d p-6 rounded-2xl border border-slate-800/90 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Your Submitted Answer (Question #{viewedTurn.sequenceNo})
                </span>
                <button
                  type="button"
                  onClick={() => setViewIndex(turns.length - 1)}
                  className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
                >
                  Jump to Active Question →
                </button>
              </div>
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                {viewedTurn.answerText}
              </div>
            </div>
          )}

          {/* Feedback Display */}
          {displayFeedback && (
            <div className="glass-panel-3d p-6 sm:p-8 rounded-3xl border border-cyan-500/40 border-t-white/[0.15] bg-slate-900/95 space-y-6 animate-fadeIn shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-base font-bold text-white">8-Dimension Rubric Scorecard</h3>
                </div>
                <span className="text-xs text-slate-400 font-medium">Question #{displayFeedback.turnSeq} Evaluation</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(displayFeedback.data.scores).map(([key, val]) => {
                  const label = RUBRIC_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
                  const pct = Math.min(100, Math.max(0, (val / 5) * 100));
                  return (
                    <div key={key} className="p-3 bg-slate-950/80 border border-slate-800/90 rounded-xl shadow-sm">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-slate-300 font-medium truncate">{label}</span>
                        <span className="text-cyan-400 font-bold">{val.toFixed(1)}/5</span>
                      </div>
                      <div className="w-full bg-slate-800/80 h-2 rounded-full overflow-hidden p-0.5">
                        <div
                          className="bg-gradient-to-r from-violet-500 to-cyan-400 h-full rounded-full transition-all shadow-[0_0_8px_rgba(34,211,238,0.4)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-900/50 shadow-sm">
                  <h4 className="text-xs font-bold text-emerald-400 mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> What You Did Well
                  </h4>
                  <ul className="text-xs text-slate-300 space-y-1.5">
                    {displayFeedback.data.whatWorked.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-emerald-400 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-900/50 shadow-sm">
                  <h4 className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" /> Missing Points & Opportunities
                  </h4>
                  <ul className="text-xs text-slate-300 space-y-1.5">
                    {displayFeedback.data.missingPoints.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-amber-400 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {displayFeedback.data.improvedAnswer && (
                <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800/90 shadow-sm">
                  <h4 className="text-xs font-bold text-violet-400 mb-1.5 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    <span>Evidence-Based Model Answer Outline</span>
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed italic">
                    "{displayFeedback.data.improvedAnswer}"
                  </p>
                </div>
              )}

              {displayFeedback.data.practiceTask && (
                <div className="p-3.5 rounded-xl bg-violet-950/40 border border-violet-800/50 flex items-start gap-3 shadow-inner">
                  <BookOpen className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-bold text-white">Recommended Practice Task:</span>
                    <p className="text-xs text-slate-300 mt-0.5">{displayFeedback.data.practiceTask}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Final Completion Report View */}
      {!loadingSession && finalReport && (
        <div className="glass-panel-3d p-6 sm:p-8 rounded-3xl border border-violet-500/40 border-t-white/[0.15] bg-gradient-to-br from-slate-900/95 via-indigo-950/50 to-slate-900/95 space-y-6 animate-fadeIn shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">Session Completed</span>
              <h2 className="text-2xl font-extrabold text-white mt-1">
                Final Mock Interview Scorecard: <span className="text-cyan-400">{finalReport.overallScore}/5.0</span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">{finalReport.summary}</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setActiveSession(null);
                  setTurns([]);
                  setLatestFeedback(null);
                  setFinalReport(null);
                  loadContext();
                }}
                className="btn-3d-primary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Start Another Session
              </button>
              <button
                type="button"
                onClick={() => onNavigate('history')}
                className="btn-3d-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                View in History
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 shadow-sm">
              <span className="text-[11px] text-slate-500 uppercase font-bold">Total Duration</span>
              <div className="text-lg font-extrabold text-white mt-1">
                {Math.round(finalReport.durationSeconds / 60)} min ({finalReport.durationSeconds}s)
              </div>
              <span className="text-[10px] text-slate-400">
                {finalReport.endedEarly ? 'Ended Early' : 'Full 20-min session'}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 shadow-sm">
              <span className="text-[11px] text-slate-500 uppercase font-bold">Questions Answered</span>
              <div className="text-lg font-extrabold text-cyan-400 mt-1">
                {finalReport.questionsAnswered}
              </div>
              <span className="text-[10px] text-slate-400">Evaluated with rubrics</span>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 shadow-sm">
              <span className="text-[11px] text-slate-500 uppercase font-bold">Technical Score</span>
              <div className="text-lg font-extrabold text-emerald-400 mt-1">
                {(finalReport.categoryScores?.technicalCorrectness ?? 0).toFixed(1)}/5.0
              </div>
              <span className="text-[10px] text-slate-400">Factual accuracy</span>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 shadow-sm">
              <span className="text-[11px] text-slate-500 uppercase font-bold">English Delivery</span>
              <div className="text-lg font-extrabold text-violet-400 mt-1">
                {(finalReport.categoryScores?.grammarVocabulary ?? 0).toFixed(1)}/5.0
              </div>
              <span className="text-[10px] text-slate-400">Grammar & clarity</span>
            </div>
          </div>

          {finalReport.categoryScores && Object.keys(finalReport.categoryScores).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(finalReport.categoryScores).map(([key, score]) => (
                <div key={key} className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs">
                  <div className="text-[10px] text-slate-400 truncate">{RUBRIC_LABELS[key] || key}</div>
                  <div className="text-sm font-bold text-cyan-300 mt-0.5">{Number(score).toFixed(1)} / 5.0</div>
                </div>
              ))}
            </div>
          )}

          <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 shadow-inner">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2">Priority Revision Tasks</h4>
            <ul className="text-xs text-slate-300 space-y-2">
              {finalReport.practiceTasks.map((t, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-cyan-400 font-bold">•</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* End Early Confirmation Dialog */}
      {confirmEndOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-sm p-6 bg-slate-900 border border-slate-800 border-t-white/[0.15] rounded-3xl shadow-2xl text-center space-y-4">
            <h3 className="text-base font-bold text-white">End Interview Session?</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your elapsed time and {answeredCount} answered question{answeredCount === 1 ? '' : 's'} will be saved and scored accurately.
            </p>
            <div className="flex gap-3 justify-center pt-2">
              <button
                type="button"
                onClick={() => setConfirmEndOpen(false)}
                className="btn-3d-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Continue Interview
              </button>
              <button
                type="button"
                disabled={endingSession}
                onClick={handleEndInterview}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer shadow-md shadow-rose-950 disabled:opacity-50"
              >
                {endingSession ? 'Saving...' : 'Confirm End'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
