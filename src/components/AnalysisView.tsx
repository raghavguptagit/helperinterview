import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  FileText,
  FileCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  Edit3,
  Save,
  Play,
  BookOpen,
  Calendar,
  RefreshCw,
  Code2,
  FolderGit2,
  Info,
} from 'lucide-react';
import { api } from '../api';
import type { User, AnalysisData, ExtractedProject } from '../types';

interface AnalysisViewProps {
  user: User;
  onStartInterview: (track: 'hr' | 'technical' | 'project_mixed', analysisId?: string) => void;
  onOpenStudyPack: (analysisId?: string) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function validateClientFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.doc')) {
    return 'Legacy .doc format is not supported. Please save as .pdf, .docx, or .txt.';
  }
  if (!/\.(pdf|docx|txt)$/i.test(lower)) {
    return `Unsupported file "${file.name}". Please upload a .pdf, .docx, or .txt file.`;
  }
  if (file.size === 0) {
    return `"${file.name}" is empty (0 bytes). Please choose a valid document.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `"${file.name}" exceeds the 10MB maximum upload limit.`;
  }
  return null;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  user,
  onStartInterview,
  onOpenStudyPack,
}) => {
  const [resumeDocId, setResumeDocId] = useState<string | null>(null);
  const [jdDocId, setJdDocId] = useState<string | null>(null);

  const [resumeFilename, setResumeFilename] = useState<string | null>(null);
  const [jdFilename, setJdFilename] = useState<string | null>(null);

  const [resumeText, setResumeText] = useState('');
  const [jdText, setJdText] = useState('');
  const [resumeDirty, setResumeDirty] = useState(false);
  const [jdDirty, setJdDirty] = useState(false);

  const [manualResumeMode, setManualResumeMode] = useState(false);
  const [isEditingResume, setIsEditingResume] = useState(false);
  const [isEditingJd, setIsEditingJd] = useState(false);

  const [uploadingResume, setUploadingResume] = useState(false);
  const [uploadingJd, setUploadingJd] = useState(false);
  const [savingResume, setSavingResume] = useState(false);
  const [savingJd, setSavingJd] = useState(false);
  const [resumeDragOver, setResumeDragOver] = useState(false);
  const [jdDragOver, setJdDragOver] = useState(false);

  const [detectedTechnologies, setDetectedTechnologies] = useState<string[]>([]);
  const [detectedProjects, setDetectedProjects] = useState<ExtractedProject[]>([]);

  const [targetCompany, setTargetCompany] = useState(user.target_company || 'Stripe');
  const [targetRole, setTargetRole] = useState(user.target_role || 'Senior Full-Stack Engineer');

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisData | null>(null);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const jdFileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate latest uploaded documents and latest analysis
  useEffect(() => {
    async function hydrateWorkspace() {
      try {
        const [docsRes, listRes] = await Promise.all([
          api.getLatestDocuments().catch(() => null),
          api.listAnalyses().catch(() => ({ analyses: [] })),
        ]);

        if (docsRes) {
          if (docsRes.resume) {
            setResumeDocId(docsRes.resume.id);
            setResumeText(docsRes.resume.extractedText);
            setResumeFilename(docsRes.resume.filename);
          }
          if (docsRes.jd) {
            setJdDocId(docsRes.jd.id);
            setJdText(docsRes.jd.extractedText);
            setJdFilename(docsRes.jd.filename);
          }
          setDetectedTechnologies(docsRes.detectedTechnologies || []);
          setDetectedProjects(docsRes.detectedProjects || []);
        }

        if (listRes.analyses && listRes.analyses.length > 0) {
          const latestId = listRes.analyses[0].id;
          const full = await api.getAnalysis(latestId);
          if (full.analysis?.result) {
            setAnalysisResult(full.analysis.result);
            setActiveAnalysisId(full.analysis.id);
            if (full.analysis.targetCompany) setTargetCompany(full.analysis.targetCompany);
            if (full.analysis.targetRole) setTargetRole(full.analysis.targetRole);
          }
        }
      } catch {
        // Safe ignore on initial hydration
      }
    }
    hydrateWorkspace();
  }, []);

  const processResumeFile = async (file: File) => {
    const validationErr = validateClientFile(file);
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setError(null);
    setStatusMessage(null);
    setUploadingResume(true);
    try {
      const res = await api.uploadResume({ file });
      setResumeDocId(res.documentId);
      setResumeText(res.extractedText);
      setResumeFilename(res.filename);
      setResumeDirty(false);
      setManualResumeMode(false);
      setIsEditingResume(false);
      setDetectedTechnologies((prev) => Array.from(new Set([...(res.detectedTechnologies || []), ...prev])));
      setDetectedProjects(res.detectedProjects || []);
      setStatusMessage(`Resume "${res.filename}" uploaded and extracted (${res.extractedText.length} characters).`);
    } catch (err: any) {
      setError('Resume upload failed: ' + (err.message || 'Could not process file.'));
    } finally {
      setUploadingResume(false);
    }
  };

  const processJdFile = async (file: File) => {
    const validationErr = validateClientFile(file);
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setError(null);
    setStatusMessage(null);
    setUploadingJd(true);
    try {
      const res = await api.uploadJd({ file });
      setJdDocId(res.documentId);
      setJdText(res.extractedText);
      setJdFilename(res.filename);
      setJdDirty(false);
      setIsEditingJd(false);
      setDetectedTechnologies((prev) => Array.from(new Set([...prev, ...(res.detectedTechnologies || [])])));
      setStatusMessage(`Job description "${res.filename}" uploaded and extracted (${res.extractedText.length} characters).`);
    } catch (err: any) {
      setError('Job description upload failed: ' + (err.message || 'Could not process file.'));
    } finally {
      setUploadingJd(false);
    }
  };

  const handleResumeFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await processResumeFile(file);
  };

  const handleJdFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await processJdFile(file);
  };

  const handleSaveResumeText = async () => {
    const trimmed = resumeText.trim();
    if (trimmed.length < 10) {
      setError('Resume text must be at least 10 characters.');
      return;
    }
    setError(null);
    setSavingResume(true);
    try {
      if (resumeDocId) {
        const res = await api.updateDocText(resumeDocId, trimmed);
        if (res.detectedTechnologies) setDetectedTechnologies(res.detectedTechnologies);
        if (res.detectedProjects) setDetectedProjects(res.detectedProjects);
      } else {
        const res = await api.uploadResume({ text: trimmed });
        setResumeDocId(res.documentId);
        setResumeFilename(res.filename);
        setDetectedTechnologies(res.detectedTechnologies || []);
        setDetectedProjects(res.detectedProjects || []);
      }
      setResumeText(trimmed);
      setResumeDirty(false);
      setIsEditingResume(false);
      setManualResumeMode(false);
      setStatusMessage('Resume text saved and indexed for mock interviews.');
    } catch (err: any) {
      setError(err.message || 'Could not save resume text.');
    } finally {
      setSavingResume(false);
    }
  };

  const handleSaveJdText = async () => {
    const trimmed = jdText.trim();
    if (trimmed.length < 10) {
      setError('Job description text must be at least 10 characters.');
      return;
    }
    setError(null);
    setSavingJd(true);
    try {
      if (jdDocId) {
        const res = await api.updateDocText(jdDocId, trimmed);
        if (res.detectedTechnologies) {
          setDetectedTechnologies((prev) => Array.from(new Set([...prev, ...res.detectedTechnologies!])));
        }
      } else {
        const res = await api.uploadJd({ text: trimmed });
        setJdDocId(res.documentId);
        setJdFilename(res.filename);
      }
      setJdText(trimmed);
      setJdDirty(false);
      setIsEditingJd(false);
      setStatusMessage('Job description saved and ready for analysis.');
    } catch (err: any) {
      setError(err.message || 'Could not save job description.');
    } finally {
      setSavingJd(false);
    }
  };

  const handleRunAnalysis = async () => {
    setError(null);
    setStatusMessage(null);
    let rId = resumeDocId;
    let jId = jdDocId;

    try {
      setAnalyzing(true);
      setAnalysisStep(1);

      const cleanResume = resumeText.trim();
      const cleanJd = jdText.trim();

      if (!rId) {
        if (cleanResume.length < 10) {
          throw new Error('Please upload a resume file or paste at least 10 characters of resume text.');
        }
        const rRes = await api.uploadResume({ text: cleanResume });
        rId = rRes.documentId;
        setResumeDocId(rId);
        setResumeFilename(rRes.filename);
        setResumeDirty(false);
        setDetectedProjects(rRes.detectedProjects || []);
        setDetectedTechnologies(rRes.detectedTechnologies || []);
      } else if (resumeDirty && cleanResume.length >= 10) {
        await api.updateDocText(rId, cleanResume);
        setResumeDirty(false);
      }
      setAnalysisStep(2);

      if (!jId) {
        if (cleanJd.length < 10) {
          throw new Error('Please upload a job description file or paste at least 10 characters of job requirements.');
        }
        const jRes = await api.uploadJd({ text: cleanJd });
        jId = jRes.documentId;
        setJdDocId(jId);
        setJdFilename(jRes.filename);
        setJdDirty(false);
      } else if (jdDirty && cleanJd.length >= 10) {
        await api.updateDocText(jId, cleanJd);
        setJdDirty(false);
      }
      setAnalysisStep(3);

      const res = await api.runAnalysis({
        resumeDocumentId: rId,
        jdDocumentId: jId,
        targetRole: targetRole.trim() || 'Target Role',
        targetCompany: targetCompany.trim() || 'Target Company',
      });

      setAnalysisStep(4);
      setAnalysisResult(res.result);
      setActiveAnalysisId(res.analysisId);
      setIsEditingResume(false);
      setIsEditingJd(false);
      setManualResumeMode(false);
      setStatusMessage('Evidence-based analysis completed and saved.');
    } catch (err: any) {
      setError(err.message || 'Analysis failed. Please check your resume and job description.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn pb-12">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-950/60 border border-violet-500/30 text-violet-300 text-xs font-semibold uppercase tracking-wider mb-2">
          <FileCheck className="w-3.5 h-3.5 text-cyan-400" />
          <span>Evidence-Based Analysis Engine</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Resume & Job Description Intelligence
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">
          Upload documents (.pdf, .docx, .txt) or paste text to map verified experience against employer requirements and personalize all 3 mock interview tracks.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-950/50 border border-rose-900/60 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {statusMessage && !error && (
        <div role="status" className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-900/60 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Target Role & Company Selector */}
      <div className="glass-panel-3d p-6 rounded-2xl border border-slate-800/90 border-t-white/[0.12] grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-xl">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Target Company</label>
          <input
            type="text"
            value={targetCompany}
            onChange={(e) => setTargetCompany(e.target.value)}
            placeholder="e.g. Stripe, Google, Amazon"
            className="input-3d w-full px-3.5 py-2.5 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Target Job Role</label>
          <input
            type="text"
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
            placeholder="e.g. Senior Full-Stack Engineer"
            className="input-3d w-full px-3.5 py-2.5 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none"
          />
        </div>
      </div>

      {/* 2-Card Ingestion Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Resume */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setResumeDragOver(true);
          }}
          onDragLeave={() => setResumeDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setResumeDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) await processResumeFile(file);
          }}
          className={`glass-panel-3d rounded-2xl p-6 border transition-all flex flex-col justify-between shadow-xl relative overflow-hidden ${
            resumeDragOver
              ? 'border-cyan-400 bg-violet-950/30 ring-2 ring-cyan-400/30'
              : 'border-slate-800/90 border-t-white/[0.12]'
          }`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-violet-600/10 rounded-full blur-2xl pointer-events-none" />
          <input
            ref={resumeFileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={handleResumeFileInput}
            data-testid="resume-file-input"
            className="hidden"
          />

          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-violet-950/80 border border-violet-500/40 flex items-center justify-center text-cyan-400 shadow-inner">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">1. Candidate Resume</h3>
                  <span className="text-[10px] text-slate-400">
                    {resumeFilename ? `Loaded: ${resumeFilename}` : 'PDF, DOCX, TXT up to 10MB'}
                  </span>
                </div>
              </div>
              {resumeText && !manualResumeMode && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => resumeFileInputRef.current?.click()}
                    disabled={uploadingResume}
                    className="text-xs text-violet-300 hover:text-white font-semibold cursor-pointer transition-colors"
                  >
                    Replace File
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingResume(!isEditingResume)}
                    className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{isEditingResume ? 'Cancel Edit' : 'Edit Text'}</span>
                  </button>
                </div>
              )}
            </div>

            {uploadingResume ? (
              <div className="border-2 border-dashed border-violet-500/50 rounded-xl p-10 text-center bg-slate-950/50 space-y-2">
                <RefreshCw className="w-7 h-7 text-cyan-400 animate-spin mx-auto" />
                <p className="text-xs font-semibold text-white">Extracting resume text...</p>
                <p className="text-[11px] text-slate-400">Parsing document structure, technologies, and projects</p>
              </div>
            ) : manualResumeMode ? (
              <div className="space-y-3">
                <textarea
                  rows={8}
                  value={resumeText}
                  onChange={(e) => {
                    setResumeText(e.target.value);
                    setResumeDirty(true);
                  }}
                  placeholder="Paste your full resume content here (summary, technical skills, work experience, and projects)..."
                  className="input-3d w-full p-3.5 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                />
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setManualResumeMode(false)}
                    className="text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    ← Back to file upload
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveResumeText}
                    disabled={savingResume || resumeText.trim().length < 10}
                    className="btn-3d-primary px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingResume ? 'Saving...' : 'Save Resume Text'}</span>
                  </button>
                </div>
              </div>
            ) : !resumeText ? (
              <div
                onClick={() => resumeFileInputRef.current?.click()}
                className="relative border-2 border-dashed border-slate-800/90 hover:border-violet-500/60 rounded-xl p-8 text-center transition-all bg-slate-950/40 group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-2xl bg-violet-950/60 border border-violet-500/30 flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform">
                  <Upload className="w-6 h-6 text-violet-400" />
                </div>
                <p className="text-xs font-semibold text-slate-200">
                  Drop your resume here or <span className="text-cyan-400 underline decoration-cyan-400/30">browse file</span>
                </p>
                <p className="text-[10px] text-slate-500 mt-1">PDF, DOCX, or TXT up to 10MB</p>
                <div
                  className="mt-4 pt-3 border-t border-slate-800/80"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setManualResumeMode(true);
                      setError(null);
                    }}
                    className="text-[11px] text-violet-400 hover:text-violet-300 hover:underline cursor-pointer"
                  >
                    Or paste resume text manually →
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Extracted Text ({resumeText.length} characters)</span>
                  <span className="text-emerald-400 font-semibold">
                    {resumeDirty ? 'Unsaved edits' : 'Saved & Ready'}
                  </span>
                </div>
                {isEditingResume ? (
                  <div className="space-y-2">
                    <textarea
                      rows={8}
                      value={resumeText}
                      onChange={(e) => {
                        setResumeText(e.target.value);
                        setResumeDirty(true);
                      }}
                      className="input-3d w-full p-3 rounded-xl text-xs text-slate-300 font-mono focus:outline-none"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveResumeText}
                        disabled={savingResume || resumeText.trim().length < 10}
                        className="btn-3d-primary px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{savingResume ? 'Saving...' : 'Save Changes'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto p-3.5 bg-slate-950/80 border border-slate-800/90 rounded-xl text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed shadow-inner">
                    {resumeText}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setResumeText('');
                      setResumeDocId(null);
                      setResumeFilename(null);
                      setResumeDirty(false);
                      setIsEditingResume(false);
                    }}
                    className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                  >
                    Clear resume
                  </button>
                  <button
                    type="button"
                    onClick={() => resumeFileInputRef.current?.click()}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer"
                  >
                    Upload different file →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Job Description */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setJdDragOver(true);
          }}
          onDragLeave={() => setJdDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setJdDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) await processJdFile(file);
          }}
          className={`glass-panel-3d rounded-2xl p-6 border transition-all flex flex-col justify-between shadow-xl relative overflow-hidden ${
            jdDragOver
              ? 'border-cyan-400 bg-cyan-950/25 ring-2 ring-cyan-400/30'
              : 'border-slate-800/90 border-t-white/[0.12]'
          }`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-600/10 rounded-full blur-2xl pointer-events-none" />
          <input
            ref={jdFileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={handleJdFileInput}
            data-testid="jd-file-input"
            className="hidden"
          />

          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-inner">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">2. Job Description</h3>
                  <span className="text-[10px] text-slate-400">
                    {jdFilename ? `Loaded: ${jdFilename}` : 'Paste job post or upload PDF/DOCX/TXT'}
                  </span>
                </div>
              </div>
              {jdText && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => jdFileInputRef.current?.click()}
                    disabled={uploadingJd}
                    className="text-xs text-violet-300 hover:text-white font-semibold cursor-pointer transition-colors"
                  >
                    Replace File
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingJd(!isEditingJd)}
                    className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{isEditingJd ? 'Cancel Edit' : 'Edit Text'}</span>
                  </button>
                </div>
              )}
            </div>

            {uploadingJd ? (
              <div className="border-2 border-dashed border-cyan-500/50 rounded-xl p-10 text-center bg-slate-950/50 space-y-2">
                <RefreshCw className="w-7 h-7 text-cyan-400 animate-spin mx-auto" />
                <p className="text-xs font-semibold text-white">Extracting job description...</p>
                <p className="text-[11px] text-slate-400">Identifying required competencies and stack</p>
              </div>
            ) : !jdDocId && !isEditingJd ? (
              <div className="space-y-3">
                <textarea
                  rows={6}
                  value={jdText}
                  onChange={(e) => {
                    setJdText(e.target.value);
                    setJdDirty(true);
                  }}
                  placeholder="Paste the target job description here (qualifications, responsibilities, tech stack), or drop/upload a file below..."
                  className="input-3d w-full p-3.5 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                  <button
                    type="button"
                    onClick={() => jdFileInputRef.current?.click()}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer flex items-center gap-1.5 font-medium"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload JD file (.pdf / .docx / .txt)</span>
                  </button>

                  {jdText.trim().length >= 10 && (
                    <button
                      type="button"
                      onClick={handleSaveJdText}
                      disabled={savingJd}
                      className="btn-3d-secondary px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Save className="w-3 h-3 text-cyan-400" />
                      <span>{savingJd ? 'Saving...' : 'Save JD Text'}</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Job Description Text ({jdText.length} characters)</span>
                  <span className="text-cyan-400 font-semibold">
                    {jdDirty ? 'Unsaved edits' : 'Saved & Ready'}
                  </span>
                </div>
                {isEditingJd ? (
                  <div className="space-y-2">
                    <textarea
                      rows={8}
                      value={jdText}
                      onChange={(e) => {
                        setJdText(e.target.value);
                        setJdDirty(true);
                      }}
                      className="input-3d w-full p-3 rounded-xl text-xs text-slate-300 font-mono focus:outline-none"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveJdText}
                        disabled={savingJd || jdText.trim().length < 10}
                        className="btn-3d-primary px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{savingJd ? 'Saving...' : 'Save Changes'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto p-3.5 bg-slate-950/80 border border-slate-800/90 rounded-xl text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed shadow-inner">
                    {jdText}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setJdText('');
                      setJdDocId(null);
                      setJdFilename(null);
                      setJdDirty(false);
                      setIsEditingJd(false);
                    }}
                    className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                  >
                    Clear job description
                  </button>
                  <button
                    type="button"
                    onClick={() => jdFileInputRef.current?.click()}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer"
                  >
                    Upload different JD file →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Extracted Resume Intelligence Preview */}
      {(detectedTechnologies.length > 0 || detectedProjects.length > 0) && (
        <div className="glass-panel-3d rounded-2xl p-5 border border-slate-800/90 border-t-white/[0.1] grid grid-cols-1 md:grid-cols-2 gap-5 shadow-lg">
          <div>
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Detected Technologies ({detectedTechnologies.length})</span>
            </h4>
            {detectedTechnologies.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {detectedTechnologies.map((tech) => (
                  <span
                    key={tech}
                    className="px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-cyan-300 font-medium"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Upload a resume or JD to detect core technologies automatically.</p>
            )}
          </div>

          <div>
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <FolderGit2 className="w-3.5 h-3.5 text-violet-400" />
              <span>Detected Resume Projects ({detectedProjects.length})</span>
            </h4>
            {detectedProjects.length > 0 ? (
              <div className="space-y-1.5">
                {detectedProjects.slice(0, 3).map((proj, idx) => (
                  <div key={idx} className="px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-200 flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">{proj.name}</span>
                    {proj.technologies.length > 0 && (
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {proj.technologies.slice(0, 3).join(', ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Include a "Projects" section in your resume to target Track 3 deep-dives.</p>
            )}
          </div>
        </div>
      )}

      {/* Action / Progress Trigger */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-2xl glass-panel-3d border border-slate-800/90 border-t-white/[0.12] shadow-xl">
        <div>
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">Run Full AI Comparison</h4>
          <p className="text-xs text-slate-400 mt-0.5">
            Compares verified evidence against qualifications and produces a 7-day preparation schedule.
          </p>
        </div>

        <button
          onClick={handleRunAnalysis}
          disabled={analyzing || uploadingResume || uploadingJd || (!resumeText.trim() && !resumeDocId) || (!jdText.trim() && !jdDocId)}
          className="w-full sm:w-auto btn-3d-primary px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wider cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {analyzing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
              <span>Analyzing Documents (Stage {analysisStep}/4)...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-cyan-300 animate-pulse" />
              <span>Run Evidence Analysis</span>
            </>
          )}
        </button>
      </div>

      {/* Analysis Results View */}
      {analysisResult && (
        <div className="space-y-8 animate-fadeIn pt-4">
          {analysisResult.aiNotice && (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-200 text-xs flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>{analysisResult.aiNotice}</span>
            </div>
          )}

          {/* Top Result Banner */}
          <div className="glass-panel-3d p-6 sm:p-8 rounded-3xl border border-violet-500/40 border-t-white/[0.15] bg-gradient-to-r from-slate-900/95 via-indigo-950/60 to-slate-900/95 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">Analysis Completed</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-xs text-slate-300 font-semibold">{targetCompany} — {targetRole}</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                  Truthful Match Score: <span className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]">{analysisResult.overallMatchScore}%</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-300/90 mt-2 max-w-2xl leading-relaxed">
                  {analysisResult.profileSummary}
                </p>
              </div>

              {/* Action Buttons for all 3 Mock Interview Tracks + Study Pack */}
              <div className="flex flex-wrap gap-2.5 shrink-0">
                <button
                  onClick={() => onStartInterview('hr', activeAnalysisId || undefined)}
                  className="btn-3d-secondary px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 text-indigo-400" /> HR Mock
                </button>
                <button
                  onClick={() => onStartInterview('technical', activeAnalysisId || undefined)}
                  className="btn-3d-primary px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" /> Technical Mock
                </button>
                <button
                  onClick={() => onStartInterview('project_mixed', activeAnalysisId || undefined)}
                  className="btn-3d-secondary px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 text-violet-400" /> Project Mock
                </button>
                <button
                  onClick={() => onOpenStudyPack(activeAnalysisId || undefined)}
                  className="btn-3d-secondary px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5 text-cyan-400" /> Study Pack
                </button>
              </div>
            </div>
          </div>

          {/* Requirements Match Table */}
          <div className="glass-panel-3d rounded-2xl p-6 border border-slate-800/90 border-t-white/[0.12] shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
              <div>
                <h3 className="text-base font-bold text-white">Requirement vs. Resume Evidence Map</h3>
                <p className="text-xs text-slate-400">Every match is supported by verified resume quotations</p>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Matched
                </span>
                <span className="flex items-center gap-1 text-amber-400 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" /> Partial
                </span>
                <span className="flex items-center gap-1 text-rose-400 font-medium">
                  <XCircle className="w-3.5 h-3.5" /> Missing
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {analysisResult.requirementsMatch.map((rm, idx) => {
                const isMatched = rm.status === 'matched';
                const isPartial = rm.status === 'partial';
                const isMissing = rm.status === 'missing';

                return (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 border-t-white/[0.05] hover:border-slate-700 transition-all shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold text-white">
                        {rm.requirement}
                      </span>
                      <span
                        className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 w-fit ${
                          isMatched
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 shadow-[0_0_8px_rgba(52,211,153,0.15)]'
                            : isPartial
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-700/60'
                            : isMissing
                            ? 'bg-rose-950/80 text-rose-300 border border-rose-700/60'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {rm.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 flex items-start gap-2 bg-slate-900/40 p-2 rounded-lg border border-slate-800/50">
                      <span className="text-slate-500 font-semibold shrink-0">Resume Quote:</span>
                      <span className="italic text-slate-300">{rm.evidence}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Strengths & Gaps */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-panel-3d rounded-2xl p-6 border border-slate-800/90 border-t-white/[0.12] shadow-xl">
              <h3 className="text-sm font-bold text-emerald-400 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Core Verified Strengths
              </h3>
              <ul className="space-y-2.5 text-xs text-slate-300">
                {analysisResult.strengths.map((str, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>{str}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-panel-3d rounded-2xl p-6 border border-slate-800/90 border-t-white/[0.12] shadow-xl">
              <h3 className="text-sm font-bold text-amber-400 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Evidence Gaps To Address
              </h3>
              <ul className="space-y-2.5 text-xs text-slate-300">
                {analysisResult.gaps.map((gap, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">•</span>
                    <span>{gap}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Truthful Keywords & Likely Topics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-panel-3d rounded-2xl p-6 border border-slate-800/90 border-t-white/[0.12] shadow-xl">
              <h3 className="text-sm font-bold text-white mb-2">Truthful Keywords To Highlight</h3>
              <p className="text-[11px] text-slate-400 mb-3">
                Terms backed by your actual experience that directly strengthen role alignment:
              </p>
              <div className="flex flex-wrap gap-2">
                {analysisResult.truthfulKeywordSuggestions.map((kw, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-lg bg-violet-950/70 border border-violet-500/40 text-cyan-300 text-xs font-semibold shadow-inner"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>

            <div className="glass-panel-3d rounded-2xl p-6 border border-slate-800/90 border-t-white/[0.12] shadow-xl">
              <h3 className="text-sm font-bold text-white mb-2">High-Probability Interview Topics</h3>
              <p className="text-[11px] text-slate-400 mb-3">
                Expected questions derived from target job responsibilities:
              </p>
              <ul className="space-y-2 text-xs text-slate-300">
                {analysisResult.likelyTopics.map((top, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-cyan-400 font-bold">Q{i + 1}.</span>
                    <span>{top}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 7-Day Personalized Roadmap */}
          <div className="glass-panel-3d rounded-2xl p-6 border border-slate-800/90 border-t-white/[0.12] shadow-xl">
            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-violet-400" />
              <span>Personalized 7-Day Interview Preparation Roadmap</span>
            </h3>
            <p className="text-xs text-slate-400 mb-5">
              Structured daily milestones targeted directly at closing your identified gaps before interview day.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
              {analysisResult.studyPlan.map((sp) => (
                <div
                  key={sp.day}
                  className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/90 border-t-white/[0.08] flex flex-col justify-between shadow-sm card-3d-hover"
                >
                  <div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-violet-600/30 text-cyan-400 border border-violet-500/30">
                      Day {sp.day}
                    </span>
                    <h4 className="text-xs font-bold text-white mt-2 mb-1 line-clamp-1">{sp.focus}</h4>
                    <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-3">{sp.task}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
