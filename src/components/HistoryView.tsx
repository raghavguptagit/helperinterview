import React, { useState, useEffect } from 'react';
import {
  History,
  Clock,
  Trash2,
  AlertTriangle,
  Play,
} from 'lucide-react';
import { api } from '../api';
import type { User, InterviewSession, InterviewTurn } from '../types';

interface HistoryViewProps {
  user: User;
  onNavigate: (tab: string, state?: any) => void;
}

const RUBRIC_LABELS: Record<string, string> = {
  technicalCorrectness: 'Technical',
  relevance: 'Relevance',
  completeness: 'Completeness',
  structure: 'Structure',
  communicationClarity: 'Clarity',
  grammarVocabulary: 'Grammar',
  conciseness: 'Conciseness',
  projectEvidence: 'Project Evidence',
};

export const HistoryView: React.FC<HistoryViewProps> = ({ user: _user, onNavigate }) => {
  const [interviews, setInterviews] = useState<InterviewSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<{
    session: InterviewSession;
    turns: InterviewTurn[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const res = await api.listInterviews();
        setInterviews(res.interviews || []);
      } catch (e: any) {
        setError('Could not load interview history: ' + (e.message || 'Unknown error'));
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSelectSession = async (session: InterviewSession) => {
    setError(null);
    try {
      const full = await api.getInterview(session.id);
      setSelectedSession(full);
    } catch (e: any) {
      setError('Could not load session details: ' + (e.message || 'Unknown error'));
    }
  };

  const handleDeleteSession = async (id: string) => {
    setError(null);
    try {
      await api.deleteInterview(id);
      setInterviews((prev) => prev.filter((s) => s.id !== id));
      if (selectedSession?.session.id === id) {
        setSelectedSession(null);
      }
      setConfirmDeleteId(null);
    } catch (e: any) {
      setError('Could not delete session: ' + (e.message || 'Unknown error'));
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn pb-12">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-950/60 border border-violet-500/30 text-violet-300 text-xs font-semibold uppercase tracking-wider mb-2">
          <History className="w-3.5 h-3.5 text-cyan-400" />
          <span>Progress & Session Archive</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Interview History & Progress Tracking
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">
          Review previous mock interview transcripts, exact answers, all 8 rubric dimensions, and resume any in-progress sessions.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-950/50 border border-rose-900/60 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="glass-panel-3d p-12 rounded-3xl border border-slate-800/90 text-center text-xs text-slate-400">
          Loading interview sessions...
        </div>
      ) : interviews.length === 0 ? (
        <div className="glass-panel-3d p-12 rounded-3xl border border-slate-800/90 border-t-white/[0.12] text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-violet-950/70 border border-violet-500/40 flex items-center justify-center mx-auto text-cyan-400 shadow-inner">
            <Clock className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white">No Interview History Yet</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Take a mock interview to start tracking your performance metrics and answer improvements.
          </p>
          <button
            onClick={() => onNavigate('interview', { track: 'hr' })}
            className="mt-2 btn-3d-primary px-6 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
          >
            Start First Mock Interview
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Session List */}
          <div className="lg:col-span-5 space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
              Completed & In-Progress Sessions ({interviews.length})
            </h3>

            {interviews.map((item) => {
              const isSelected = selectedSession?.session.id === item.id;
              const durationMin = Math.round(item.duration_seconds / 60);
              const score = item.finalReport?.overallScore;
              const isCompleted = item.status === 'completed';

              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectSession(item)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between card-3d-hover ${
                    isSelected
                      ? 'bg-violet-950/50 border-violet-500/60 shadow-lg shadow-violet-950/40 border-t-white/[0.15]'
                      : 'bg-slate-950/70 border-slate-800/90 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white capitalize">
                          {item.session_type === 'hr'
                            ? 'HR & Behavioral'
                            : item.session_type === 'technical'
                            ? 'Technical & Design'
                            : 'Project Deep Dive'}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 uppercase font-medium">
                          {item.mode}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 block font-mono">
                        {new Date(item.created_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-right">
                      {typeof score === 'number' ? (
                        <>
                          <span className="text-sm font-extrabold text-cyan-400">{score}</span>
                          <span className="text-[10px] text-slate-500"> / 5.0</span>
                        </>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/60 text-cyan-300 border border-cyan-800/50 font-semibold">
                          In Progress
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2.5 border-t border-slate-800/80 gap-2">
                    <span className="text-slate-400 text-[11px]">
                      {isCompleted
                        ? `Duration: ${durationMin} min ${item.ended_early ? '(Ended early)' : '(Full session)'}`
                        : 'Session active — resume anytime'}
                    </span>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {!isCompleted && (
                        <button
                          type="button"
                          onClick={() => onNavigate('interview', { sessionId: item.id })}
                          className="px-2 py-1 rounded-lg bg-cyan-950/70 text-cyan-300 hover:text-white border border-cyan-800/60 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Play className="w-2.5 h-2.5" /> Resume
                        </button>
                      )}
                      {confirmDeleteId === item.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteSession(item.id)}
                            className="text-[10px] font-bold text-rose-300 hover:text-white bg-rose-700 px-2 py-0.5 rounded cursor-pointer"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[10px] text-slate-400 hover:text-white px-1 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="text-slate-500 hover:text-rose-400 p-1 transition-colors cursor-pointer"
                          title="Delete session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detailed Transcript View */}
          <div className="lg:col-span-7">
            {selectedSession ? (
              <div className="glass-panel-3d p-6 sm:p-8 rounded-3xl border border-slate-800/90 border-t-white/[0.12] space-y-6 shadow-2xl relative overflow-hidden">
                <div className="border-b border-slate-800 pb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                      Session Transcript & Evaluation
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      {new Date(selectedSession.session.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
                    <h3 className="text-lg font-extrabold text-white capitalize">
                      {selectedSession.session.session_type === 'hr'
                        ? 'HR & Behavioral Track'
                        : selectedSession.session.session_type === 'technical'
                        ? 'Technical & Architecture Track'
                        : 'Project Deep Dive Track'}
                    </h3>
                    {selectedSession.session.status !== 'completed' && (
                      <button
                        type="button"
                        onClick={() => onNavigate('interview', { sessionId: selectedSession.session.id })}
                        className="btn-3d-primary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Play className="w-3 h-3" /> Resume Session
                      </button>
                    )}
                  </div>
                  {selectedSession.session.finalReport && (
                    <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                      {selectedSession.session.finalReport.summary}
                    </p>
                  )}
                </div>

                <div className="space-y-5">
                  {selectedSession.turns.map((turn) => (
                    <div
                      key={turn.id}
                      className="p-4 sm:p-5 rounded-2xl bg-slate-950/80 border border-slate-800/90 space-y-3 shadow-sm card-3d-hover"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-cyan-300">
                          Question #{turn.sequenceNo} ({turn.questionCategory})
                        </span>
                      </div>

                      <p className="text-xs sm:text-sm font-semibold text-white leading-relaxed">
                        "{turn.questionText}"
                      </p>

                      <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-200">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
                          Candidate Answer:
                        </span>
                        <p className="leading-relaxed">{turn.answerText || '[Pending answer]'}</p>
                      </div>

                      {turn.feedback && (
                        <div className="pt-2.5 border-t border-slate-800/80 space-y-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            8-Dimension Rubric Evaluation
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                            {Object.entries(turn.feedback.scores).map(([k, v]) => (
                              <div key={k} className="p-2 rounded-lg bg-slate-900 border border-slate-800/60 text-slate-300">
                                <span className="text-[10px] text-slate-400 block truncate font-medium">
                                  {RUBRIC_LABELS[k] || k}
                                </span>
                                <span className="font-bold text-cyan-400">{v.toFixed(1)}/5</span>
                              </div>
                            ))}
                          </div>
                          {turn.feedback.improvedAnswer && (
                            <div className="p-3 rounded-xl bg-violet-950/30 text-xs text-slate-300 italic border border-violet-800/40 shadow-inner">
                              <span className="text-violet-400 font-bold not-italic text-[10px] block mb-0.5">
                                Improved Formulation:
                              </span>
                              "{turn.feedback.improvedAnswer}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="glass-panel-3d p-12 rounded-3xl border border-slate-800/90 text-center text-slate-400 text-xs shadow-xl">
                Select a session on the left to review question-by-question transcripts and 8-dimension rubric feedback.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
