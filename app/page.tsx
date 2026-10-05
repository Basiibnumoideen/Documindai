'use client';

import { useState, useRef, useEffect } from 'react';
import React from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: number[];
  timestamp?: string;
}

// Lightweight formatted text renderer for bolding, bullet points, and inline code
function FormattedText({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <div className="space-y-2 leading-relaxed text-[13.5px] sm:text-[14px]">
      {lines.map((line, lIdx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={lIdx} className="h-1.5" />;
        }

        // Bullet point formatting
        const isBullet = trimmed.startsWith('* ') || trimmed.startsWith('- ') || trimmed.startsWith('• ');
        const cleanLine = isBullet ? trimmed.substring(2) : trimmed;

        // Parse inline **bold** and `code` text
        const parts = cleanLine.split(/(\*\*.*?\*\*|`[^`]+`)/g);

        const renderedLine = parts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={pIdx} className="font-semibold text-white">
                {part.slice(2, -2)}
              </strong>
            );
          }
          if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
            return (
              <code key={pIdx} className="px-1.5 py-0.5 rounded bg-white/[0.08] text-cyan-300 font-mono text-[12.5px] border border-white/[0.06]">
                {part.slice(1, -1)}
              </code>
            );
          }
          return <span key={pIdx}>{part}</span>;
        });

        if (isBullet) {
          return (
            <div key={lIdx} className="flex items-start gap-2 ml-1">
              <span className="text-cyan-400 mt-1 text-xs">•</span>
              <div className="flex-1">{renderedLine}</div>
            </div>
          );
        }

        return <p key={lIdx}>{renderedLine}</p>;
      })}
    </div>
  );
}

export default function Home() {
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'idle' | 'loading' | 'success' | 'error';
    message: string;
  }>({ type: 'idle', message: '' });

  const [activeDocName, setActiveDocName] = useState<string>('');
  const [activeDocChunks, setActiveDocChunks] = useState<number>(0);
  const [activeDocId, setActiveDocId] = useState<string | number | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [question, setQuestion] = useState('');
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Responsive sidebar open/close state (Icon-only toggle)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore session from localStorage on initial page load
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const savedSession = localStorage.getItem('documind_pdf_session');
        if (savedSession) {
          const session = JSON.parse(savedSession);
          if (session?.docName) {
            setActiveDocName(session.docName);
            setActiveDocChunks(session.chunks || 0);
            if (session.docId) setActiveDocId(session.docId);
            if (Array.isArray(session.suggestedQuestions) && session.suggestedQuestions.length > 0) {
              setSuggestedQuestions(session.suggestedQuestions);
            }
          }
        }

        const savedChat = localStorage.getItem('documind_chat_history');
        if (savedChat) {
          const parsedHistory = JSON.parse(savedChat);
          if (Array.isArray(parsedHistory) && parsedHistory.length > 0) {
            setChatLog(parsedHistory);
          }
        }
      } catch (err) {
        console.warn('Failed to load session from localStorage:', err);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  // Persist chat log whenever it changes
  useEffect(() => {
    if (chatLog.length > 0) {
      try {
        localStorage.setItem('documind_chat_history', JSON.stringify(chatLog));
      } catch (err) {
        console.warn('Failed to persist chat to localStorage:', err);
      }
    }
  }, [chatLog]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog, loading]);

  // Global shortcut (Ctrl+B / Cmd+B) to toggle Document Hub
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Unified trigger to open system file picker from ANY upload button in UI
  const triggerFileUpload = () => {
    setIsSidebarOpen(true);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 80);
  };

  // Core upload pipeline executed when a file is selected anywhere
  const uploadPdfFile = async (fileToUpload: File) => {
    // Client-side security pre-flight checks
    if (!fileToUpload) return;

    if (fileToUpload.size > 25 * 1024 * 1024) {
      setUploadStatus({
        type: 'error',
        message: `Security Reject: File exceeds maximum allowed size (25 MB). Selected file is ${(fileToUpload.size / (1024 * 1024)).toFixed(1)} MB.`,
      });
      return;
    }

    if (fileToUpload.size < 32) {
      setUploadStatus({
        type: 'error',
        message: 'Security Reject: File is empty or corrupted (under 32 bytes).',
      });
      return;
    }

    if (!fileToUpload.name.toLowerCase().endsWith('.pdf') && fileToUpload.type !== 'application/pdf') {
      setUploadStatus({
        type: 'error',
        message: 'Security Reject: Only genuine PDF documents (.pdf) are accepted.',
      });
      return;
    }

    setSelectedFile(fileToUpload);
    setIsUploading(true);
    setUploadStatus({
      type: 'loading',
      message: `Analyzing, chunking & generating embeddings for "${fileToUpload.name}"...`,
    });

    const formData = new FormData();
    formData.append('file', fileToUpload);

    try {
      const res = await fetch('/api/upload-pdf', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        const fileName = data.docName || fileToUpload.name;
        const totalChunks = data.totalChunks || 1;
        const resolvedDocId = data.docId || null;
        const questions: string[] = data.suggestedQuestions || [
          `Give me a high-level executive summary of "${fileName}".`,
          `What are the core conclusions and key findings in "${fileName}"?`,
          `Extract the top metrics, statistics, and critical data points.`,
          `What actionable recommendations or next steps are outlined?`,
        ];

        setActiveDocName(fileName);
        setActiveDocChunks(totalChunks);
        setActiveDocId(resolvedDocId);
        setSuggestedQuestions(questions);

        // Persist session to localStorage so refresh keeps document and tailored questions active
        try {
          localStorage.setItem(
            'documind_pdf_session',
            JSON.stringify({
              docName: fileName,
              chunks: totalChunks,
              docId: resolvedDocId,
              suggestedQuestions: questions,
              timestamp: Date.now(),
            })
          );
        } catch (err) {
          console.warn('Failed to save document session:', err);
        }

        setUploadStatus({
          type: 'success',
          message: `Indexed "${fileName}" (${totalChunks} chunks)!`,
        });

        // Add confirmation message to chat with tailored starters
        setChatLog(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `📄 **"${fileName}"** has been uploaded and indexed into ${totalChunks} vector chunks!\n\nI have analyzed its contents and generated tailored starter questions. Ask anything or pick a suggested topic below!`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);

        // On mobile, close sidebar automatically
        if (typeof window !== 'undefined' && window.innerWidth < 1024) {
          setIsSidebarOpen(false);
        }
      } else {
        setUploadStatus({
          type: 'error',
          message: data.error || 'Failed to parse and embed PDF.',
        });
      }
    } catch {
      setUploadStatus({
        type: 'error',
        message: 'Network error occurred during upload. Please check your connection.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        uploadPdfFile(file);
      } else {
        setUploadStatus({
          type: 'error',
          message: 'Please select a valid PDF file.',
        });
      }
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        uploadPdfFile(file);
      } else {
        setUploadStatus({
          type: 'error',
          message: 'Only PDF documents are supported.',
        });
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // Ask question handler (strictly scoped to active document)
  async function handleAsk(e?: React.FormEvent, customQuestion?: string) {
    if (e) e.preventDefault();
    const query = (customQuestion || question).trim();
    if (!query || loading) return;

    setQuestion('');
    setLoading(true);

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Append user message immediately
    setChatLog(prev => [
      ...prev,
      { role: 'user', content: query, timestamp: time },
    ]);

    try {
      const res = await fetch('/api/ask-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: query,
          docName: activeDocName,
          docId: activeDocId,
        }),
      });

      const data = await res.json();
      const responseTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (data.success) {
        setChatLog(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.answer,
            sources: data.sources,
            timestamp: responseTime,
          },
        ]);
      } else {
        setChatLog(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.error
              ? `Error: ${data.error}`
              : "I couldn't find relevant information in the uploaded document.",
            timestamp: responseTime,
          },
        ]);
      }
    } catch {
      setChatLog(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Network error occurred while fetching the answer. Please try again.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handlePromptClick = (prompt: string) => {
    setQuestion(prompt);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
    // Auto-execute prompt for immediate response
    setTimeout(() => {
      handleAsk(undefined, prompt);
    }, 50);
  };

  const clearChat = () => {
    setChatLog([]);
    try {
      localStorage.removeItem('documind_chat_history');
    } catch (err) {
      console.warn('Failed to clear chat history:', err);
    }
  };

  // Detach or clear active document
  const handleDetachDoc = () => {
    setActiveDocName('');
    setActiveDocChunks(0);
    setActiveDocId(null);
    setSuggestedQuestions([]);
    setSelectedFile(null);
    setUploadStatus({ type: 'idle', message: '' });
    try {
      localStorage.removeItem('documind_pdf_session');
      localStorage.removeItem('documind_chat_history');
    } catch (err) {
      console.warn('Failed to reset session:', err);
    }
    setChatLog([]);
  };

  return (
    <div className="relative h-[100dvh] w-full bg-[#07090e] text-slate-100 flex flex-col overflow-hidden selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Background Decorative Ambient Gradients */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-32 left-1/4 w-[450px] h-[450px] bg-indigo-600/15 rounded-full blur-[130px] animate-glow" />
        <div className="absolute top-1/3 -right-32 w-[500px] h-[500px] bg-cyan-600/10 rounded-full blur-[150px]" />
        <div className="absolute -bottom-32 left-1/3 w-[450px] h-[450px] bg-violet-700/10 rounded-full blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff05_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />
      </div>

      {/* Top Minimalist Navigation Header */}
      <header className="relative z-30 flex-shrink-0 h-14 border-b border-white/[0.08] bg-[#090d16]/90 backdrop-blur-xl px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 transition-all">
        {/* Left: Professional Icon-Only Sidebar Toggle + Brand Logo */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => setIsSidebarOpen(prev => !prev)}
            className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all cursor-pointer flex-shrink-0 active:scale-95 shadow-sm ${
              isSidebarOpen
                ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 hover:text-white'
                : 'bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] border border-white/[0.08]'
            }`}
            title={isSidebarOpen ? 'Collapse Document Hub (Ctrl+B)' : 'Open Document Hub (Ctrl+B)'}
            aria-label="Toggle Document Hub"
          >
            <svg
              className="w-4 h-4 transition-transform duration-200"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="3" />
              <path d="M9 3v18" />
              {isSidebarOpen ? (
                <path d="m15 15-3-3 3-3" strokeWidth="2" />
              ) : (
                <path d="m13 9 3 3-3 3" strokeWidth="2" />
              )}
            </svg>
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 via-indigo-600 to-cyan-400 p-[1px] flex-shrink-0 shadow-md shadow-indigo-500/20">
              <div className="w-full h-full bg-[#090d16] rounded-[7px] flex items-center justify-center">
                <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold tracking-tight text-sm sm:text-base text-white truncate">
                  DocuMind<span className="text-cyan-400">.ai</span>
                </span>
                <span className="hidden md:inline-block text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.2 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
                  RAG
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Active Document Badge (No upload button in header) */}
        <div className="flex items-center gap-2 min-w-0 max-w-[180px] sm:max-w-xs md:max-w-md">
          {activeDocName && (
            <button
              onClick={() => setIsSidebarOpen(prev => !prev)}
              className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 text-xs font-medium truncate transition-all cursor-pointer shadow-sm"
              title={`Active PDF: ${activeDocName}. Click to toggle Document Hub.`}
            >
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="truncate">{activeDocName}</span>
              {activeDocChunks > 0 && (
                <span className="hidden md:inline text-[10px] text-emerald-300/80 font-mono">
                  ({activeDocChunks} chunks)
                </span>
              )}
            </button>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <span className="hidden xl:inline-block text-[11px] font-mono text-slate-400 px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.05]">
            Gemini 3.5 Flash
          </span>

          {chatLog.length > 0 && (
            <button
              onClick={clearChat}
              className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
              title="Clear conversation"
              aria-label="Clear chat"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <div className="relative z-10 flex-1 flex overflow-hidden w-full">
        {/* Mobile Backdrop Overlay */}
        {isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden fixed top-14 inset-x-0 bottom-0 z-40 bg-black/75 backdrop-blur-sm transition-opacity"
            aria-hidden="true"
          />
        )}

        {/* Collapsible Document Sidebar (Works on BOTH PC and Mobile) */}
        <aside
          className={`fixed lg:static top-14 lg:top-0 bottom-0 left-0 z-40 lg:z-auto bg-[#090d16] lg:bg-transparent flex flex-col flex-shrink-0 overflow-y-auto transition-all duration-300 ease-in-out ${isSidebarOpen
              ? 'w-[85vw] max-w-[340px] sm:max-w-[360px] lg:w-[380px] p-4 sm:p-5 border-r border-white/[0.08] translate-x-0 opacity-100'
              : '-translate-x-full lg:translate-x-0 lg:w-0 lg:p-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none overflow-hidden'
            }`}
        >
          {/* Header of Document Hub (Collapse button removed, controlled cleanly via header toggle) */}
          <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-white/[0.08] flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
              </span>
              <span className="text-xs sm:text-sm font-semibold tracking-wide text-slate-200">Document Hub</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
              {activeDocName ? '1 Active' : 'Ready'}
            </span>
          </div>

          <div className="space-y-4">
            {/* Active Document Card if loaded */}
            {activeDocName && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between gap-2 shadow-sm">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-emerald-300 truncate" title={activeDocName}>
                      {activeDocName}
                    </p>
                    <p className="text-[10px] text-emerald-400/80 font-mono">
                      {activeDocChunks} chunks indexed
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDetachDoc}
                  className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors flex-shrink-0 cursor-pointer"
                  title="Detach document and start fresh"
                  aria-label="Detach document"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}

            {/* Card 1: Document Upload */}
            <div className="rounded-2xl bg-slate-900/80 border border-white/[0.08] p-4 sm:p-5 shadow-xl backdrop-blur-md">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded bg-indigo-500/20 text-indigo-400 text-xs font-bold">
                    1
                  </span>
                  <h2 className="font-semibold text-xs sm:text-sm text-slate-200">Upload PDF</h2>
                </div>
                <span className="text-[11px] text-slate-500">PDF RAG</span>
              </div>

              {/* Dropzone Box */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`relative cursor-pointer group rounded-xl border-2 border-dashed p-4 sm:p-5 transition-all duration-200 flex flex-col items-center justify-center text-center ${isDragging
                    ? 'border-indigo-400 bg-indigo-500/10'
                    : selectedFile
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-white/10 hover:border-indigo-500/40 hover:bg-white/[0.02]'
                  }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  name="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2.5 transition-transform duration-200 group-hover:scale-105 ${selectedFile
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                    }`}
                >
                  {selectedFile ? (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  )}
                </div>

                {selectedFile ? (
                  <div className="space-y-1 w-full px-2">
                    <p className="text-xs sm:text-sm font-medium text-slate-200 truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px] text-slate-400">{formatFileSize(selectedFile.size)}</p>
                    <span className="inline-block text-[11px] text-indigo-400 hover:text-indigo-300 font-medium underline">
                      Change document
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs sm:text-sm font-medium text-slate-200">
                      <span className="text-indigo-400">Click to browse</span> or drop PDF
                    </p>
                    <p className="text-[11px] text-slate-500">Supports standard PDF files</p>
                  </div>
                )}
              </div>

              {/* Upload Button */}
              <div className="mt-3.5">
                <button
                  type="button"
                  onClick={() => selectedFile && uploadPdfFile(selectedFile)}
                  disabled={!selectedFile || isUploading}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-lg transition-all duration-200 ${!selectedFile || isUploading
                      ? 'bg-slate-800/80 text-slate-500 cursor-not-allowed border border-white/5'
                      : 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white shadow-indigo-500/25 active:scale-[0.99] cursor-pointer'
                    }`}
                >
                  {isUploading ? (
                    <>
                      <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span>Embedding Chunks...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                      <span>Process & Embed PDF</span>
                    </>
                  )}
                </button>
              </div>

              {/* Status Alert */}
              {uploadStatus.message && (
                <div
                  className={`mt-3 p-2.5 rounded-xl text-xs flex items-start gap-2 border transition-all ${uploadStatus.type === 'loading'
                      ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300'
                      : uploadStatus.type === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                        : uploadStatus.type === 'error'
                          ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                >
                  {uploadStatus.type === 'loading' && (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin flex-shrink-0 mt-0.5" />
                  )}
                  {uploadStatus.type === 'success' && (
                    <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {uploadStatus.type === 'error' && (
                    <svg className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  )}
                  <span className="leading-snug">{uploadStatus.message}</span>
                </div>
              )}
            </div>

            {/* Card 2: Quick Starters (ONLY visible when document is uploaded & ready) */}
            {activeDocName && suggestedQuestions.length > 0 && (
              <div className="rounded-2xl bg-slate-900/80 border border-white/[0.08] p-4 sm:p-5 shadow-xl backdrop-blur-md">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded bg-cyan-500/20 text-cyan-400 text-xs font-bold">
                    2
                  </span>
                  <h2 className="font-semibold text-xs sm:text-sm text-slate-200">Recommended Questions</h2>
                </div>
                <p className="text-[11px] text-slate-400 mb-2.5">
                  Questions tailored to <span className="text-white font-medium truncate inline-block max-w-[170px] align-bottom">{activeDocName}</span>:
                </p>

                <div className="space-y-1.5">
                  {suggestedQuestions.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePromptClick(prompt)}
                      className="w-full text-left p-2.5 rounded-xl text-xs text-slate-300 hover:text-white bg-white/[0.02] hover:bg-indigo-500/10 border border-white/[0.05] hover:border-indigo-500/30 transition-all flex items-start justify-between group cursor-pointer"
                    >
                      <span className="pr-2 leading-relaxed">
                        {idx === 0 && (
                          <span className="inline-block text-[10px] text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.2 rounded font-semibold mr-1.5 uppercase">
                            Summary
                          </span>
                        )}
                        {prompt}
                      </span>
                      <svg
                        className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 flex-shrink-0 mt-0.5 transform group-hover:translate-x-0.5 transition-transform"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Card 3: Technical Pipeline */}
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3 text-[11px] text-slate-400 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Embeddings</span>
                <span className="font-mono text-indigo-300">gemini-embedding-001</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Search</span>
                <span className="font-mono text-cyan-300">Hybrid (Dense + Lexical)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Synthesis</span>
                <span className="font-mono text-violet-300">Gemini 3.5 Flash</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Main Chat Interface */}
        <section className="flex-1 flex flex-col h-full min-w-0 bg-transparent overflow-hidden">
          {/* Chat Messages Stream */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
            {chatLog.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 max-w-2xl mx-auto my-auto">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-tr from-indigo-500/20 via-violet-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center mb-3.5 shadow-inner">
                  <svg className="w-7 h-7 sm:w-8 sm:h-8 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </svg>
                </div>

                <h3 className="text-lg sm:text-xl font-bold text-white mb-1.5 tracking-tight">
                  {activeDocName ? `Ready to explore "${activeDocName}"` : 'Chat with your PDF documents'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mb-5 max-w-md">
                  {activeDocName
                    ? `Indexed ${activeDocChunks} vector chunks. Select any starter below or ask a custom question:`
                    : 'Upload any PDF document to begin. The AI retrieves grounded vector chunks and cites exact source pages.'}
                </p>

                {/* Primary Upload CTA Button when no document is active */}
                {!activeDocName ? (
                  <button
                    type="button"
                    onClick={triggerFileUpload}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-indigo-500/25 transition-all cursor-pointer active:scale-95"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Upload Document to Start</span>
                  </button>
                ) : (
                  /* Dynamic Tailored Question Cards (ONLY shown when document IS uploaded) */
                  suggestedQuestions.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left mt-2">
                      {suggestedQuestions.map((q, idx) => (
                        <div
                          key={idx}
                          onClick={() => handlePromptClick(q)}
                          className="cursor-pointer p-3.5 rounded-xl bg-slate-900/60 hover:bg-indigo-500/10 border border-white/[0.08] hover:border-indigo-500/30 transition-all flex flex-col justify-between group shadow-sm"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                              {idx === 0 ? '📑 Executive Summary' : `💡 Question ${idx + 1}`}
                            </span>
                            <svg
                              className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 transform group-hover:translate-x-0.5 transition-transform"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </div>
                          <p className="text-xs font-medium text-slate-200 group-hover:text-white leading-relaxed">
                            {q}
                          </p>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            ) : (
              chatLog.map((msg, index) => (
                <div
                  key={index}
                  className={`flex gap-2.5 sm:gap-3 text-sm ${msg.role === 'user' ? 'justify-end items-start' : 'justify-start items-start'
                    }`}
                >
                  {/* Assistant Avatar */}
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-400 p-[1px] flex-shrink-0 shadow-md mt-0.5">
                      <div className="w-full h-full bg-slate-900 rounded-[7px] sm:rounded-[11px] flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* Message Bubble Container */}
                  <div
                    className={`group relative max-w-[88%] sm:max-w-[80%] rounded-2xl p-4 sm:p-4.5 transition-all shadow-md ${msg.role === 'user'
                        ? 'bg-gradient-to-br from-[#1b2234] to-[#131722] border border-indigo-500/25 text-slate-100 rounded-tr-sm ml-auto shadow-indigo-950/20'
                        : 'bg-[#0f1422]/90 border border-white/[0.08] text-slate-100 rounded-tl-sm backdrop-blur-md shadow-black/25'
                      }`}
                  >
                    {/* Role Header & Timestamp */}
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs font-semibold tracking-wide ${msg.role === 'user' ? 'text-indigo-300' : 'text-indigo-300'
                            }`}
                        >
                          {msg.role === 'user' ? 'You' : 'DocuMind Assistant'}
                        </span>
                        {msg.role === 'assistant' && (
                          <span className="text-[10px] text-slate-500 font-mono hidden sm:inline px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            RAG
                          </span>
                        )}
                      </div>
                      {msg.timestamp && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {msg.timestamp}
                        </span>
                      )}
                    </div>

                    {/* Formatted Markdown Content */}
                    <FormattedText text={msg.content} />

                    {/* Assistant Message Footer: Left has Upload / Citations, Right has Copy button */}
                    {msg.role === 'assistant' && (
                      <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-3 flex-wrap">
                        {/* Left: Upload CTA or Page Citations */}
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          {!activeDocName && msg.content.includes('upload a PDF') ? (
                            <button
                              type="button"
                              onClick={triggerFileUpload}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500/20 to-cyan-500/20 hover:from-indigo-500/30 hover:to-cyan-500/30 border border-indigo-500/30 text-indigo-300 hover:text-white text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
                            >
                              <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                              </svg>
                              <span>Open Document Hub & Upload</span>
                            </button>
                          ) : msg.sources && msg.sources.length > 0 ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
                                <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                                </svg>
                                <span>Citations:</span>
                              </div>
                              {Array.from(new Set(msg.sources)).map((page, pIdx) => (
                                <span
                                  key={pIdx}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[11px] font-medium hover:bg-cyan-500/20 transition-colors"
                                >
                                  Page {page}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-500 font-mono">
                              {activeDocName || 'DocuMind AI'}
                            </span>
                          )}
                        </div>

                        {/* Right: Copy Icon Button (Transparent, pure icon only, no background/border box) */}
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.content, index)}
                          className="p-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer active:scale-90 ml-auto flex items-center justify-center focus:outline-none"
                          title={copiedIndex === index ? 'Copied to clipboard' : 'Copy response'}
                          aria-label="Copy response"
                        >
                          {copiedIndex === index ? (
                            <svg
                              className="w-4 h-4 text-emerald-400 transition-transform scale-110"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg
                              className="w-4 h-4 transition-colors"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* User Avatar */}
                  {msg.role === 'user' && (
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-[#161a26] border border-indigo-500/30 flex items-center justify-center flex-shrink-0 text-indigo-300 shadow-sm mt-0.5">
                      <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Loading Wave Animation */}
            {loading && (
              <div className="flex gap-2.5 sm:gap-3 text-sm justify-start animate-pulse">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-400 p-[1px] flex-shrink-0">
                  <div className="w-full h-full bg-slate-900 rounded-[7px] sm:rounded-[11px] flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  </div>
                </div>
                <div className="bg-slate-800/70 border border-white/[0.08] rounded-2xl p-3.5 sm:p-4 text-slate-300 flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-slate-400">Searching chunks & formulating answer...</span>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Floating Pinned Chat Input Bar */}
          <div className="flex-shrink-0 p-2.5 sm:p-4 border-t border-white/[0.08] bg-[#090d16]/95 backdrop-blur-xl pb-safe">
            <div className="max-w-4xl mx-auto">
              <form onSubmit={handleAsk} className="relative flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder={
                    activeDocName
                      ? `Ask anything about "${activeDocName}"...`
                      : 'Ask a question or upload a document...'
                  }
                  disabled={loading}
                  className="w-full bg-slate-900/90 text-slate-100 placeholder-slate-500 text-base sm:text-sm rounded-xl px-4 py-3 sm:py-3.5 pr-20 sm:pr-24 border border-white/10 focus:outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 shadow-inner transition-all disabled:opacity-50"
                />

                <div className="absolute right-2 flex items-center gap-1.5">
                  <span className="hidden sm:inline-block text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/50">
                    Enter ↵
                  </span>
                  <button
                    type="submit"
                    disabled={loading || !question.trim()}
                    className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center transition-all duration-200 ${loading || !question.trim()
                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                        : 'bg-gradient-to-tr from-indigo-500 to-cyan-500 text-white shadow-md shadow-indigo-500/30 hover:scale-105 active:scale-95 cursor-pointer'
                      }`}
                    title="Send message"
                    aria-label="Send message"
                  >
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </div>
              </form>

              <p className="text-[10px] sm:text-[11px] text-slate-500 mt-1.5 text-center truncate">
                Answers are strictly grounded in document vector embeddings with page citations.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}