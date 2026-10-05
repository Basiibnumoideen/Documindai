'use client';

import { useState, useRef, useEffect } from 'react';
import React from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: number[];
  timestamp?: string;
}

interface UploadApiResponse {
  success?: boolean;
  message?: string;
  docName?: string;
  totalChunks?: number;
  docId?: string | number | null;
  suggestedQuestions?: string[];
  error?: string;
}

interface AskApiResponse {
  success?: boolean;
  answer?: string;
  sources?: number[];
  docName?: string;
  error?: string;
}

interface TutorialStep {
  badge: string;
  title: string;
  description: string;
  iconName: 'sparkles' | 'upload' | 'cpu' | 'chat' | 'keyboard';
  highlights: string[];
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    badge: 'Welcome to DocuMind AI',
    title: 'Your Grounded Document Intelligence Hub',
    description: 'Transform complex PDFs, research papers, legal contracts, and study materials into an interactive, conversational workspace. Answers strictly cite verified page numbers—eliminating AI hallucinations completely.',
    iconName: 'sparkles',
    highlights: [
      '100% Free-Tier Architecture (Next.js 16 + Google Gemini Flash + Supabase pgvector)',
      'Dual-tier vector storage with automatic high-speed local fallback',
      'Strict grounding: every assertion is backed by exact source page excerpts',
    ],
  },
  {
    badge: 'Step 1: Document Ingestion',
    title: 'Upload Any PDF Document',
    description: 'Select or drag & drop your PDF file into the Document Hub on the left. DocuMind AI immediately scans and validates your document for malicious payloads.',
    iconName: 'upload',
    highlights: [
      'Binary magic bytes (%PDF-) verification to block disguised files',
      'Exploit & malware detection (blocks /Launch and embedded executable objects)',
      'Automatic path traversal and filename injection sanitization',
    ],
  },
  {
    badge: 'Step 2: Vector Intelligence',
    title: 'Zero-Dependency Indexing & Smart Starters',
    description: 'Our unpdf engine extracts clean text page-by-page. Content is split into ~350-word sliding window chunks with 60-word overlap, and embedded into 768-dim mathematical vectors.',
    iconName: 'cpu',
    highlights: [
      'High-speed concurrent batch embedding generation with Google Gemini',
      'Dynamic starter generator synthesizes an Executive Summary + 3 tailored questions',
      'Saved automatically to Supabase pgvector or high-speed local vector fallback',
    ],
  },
  {
    badge: 'Step 3: Grounded Research',
    title: 'Chat with Verified Page Citations',
    description: 'Ask deep-dive questions, request executive summaries, or extract financial figures. Every answer highlights concepts and provides clickable page references like [Page 3].',
    iconName: 'chat',
    highlights: [
      'Hybrid retrieval score blends 70% dense vector semantics + 30% lexical keywords',
      'One-click markdown text copy button on every AI answer for rapid note-taking',
      'Conversation history and active document session persist across browser reloads',
    ],
  },
  {
    badge: 'Step 4: Pro Shortcuts',
    title: 'Keyboard Shortcuts & Power Tools',
    description: 'Work efficiently with built-in productivity shortcuts designed for document researchers and analysts.',
    iconName: 'keyboard',
    highlights: [
      'Press Ctrl + B (or Cmd + B) anywhere to open or collapse the Document Hub',
      'Press Enter to submit your question; Shift + Enter for new lines',
      'Revisit this guide or view developer details anytime via the top header buttons',
    ],
  },
];

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

  // Interactive Onboarding Tutorial State
  const [showTutorial, setShowTutorial] = useState<boolean>(false);
  const [tutorialStep, setTutorialStep] = useState<number>(0);
  const [dontShowTutorialAgain, setDontShowTutorialAgain] = useState<boolean>(false);

  // About Project & Developer Modal State
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [aboutActiveTab, setAboutActiveTab] = useState<'project' | 'developer' | 'architecture'>('project');
  const [copiedEmail, setCopiedEmail] = useState<boolean>(false);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText('basiibnumoideen@gmail.com');
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleCloseTutorial = () => {
    setShowTutorial(false);
    if (dontShowTutorialAgain) {
      try {
        localStorage.setItem('documind_tutorial_seen', 'true');
      } catch {
        // ignore
      }
    }
  };

  const handleCompleteTutorial = () => {
    setShowTutorial(false);
    try {
      localStorage.setItem('documind_tutorial_seen', 'true');
    } catch {
      // ignore
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const centerFileInputRef = useRef<HTMLInputElement>(null);
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

        // Check if first-time user should see the tutorial walkthrough
        const hasSeenTutorial = localStorage.getItem('documind_tutorial_seen');
        if (!hasSeenTutorial) {
          setShowTutorial(true);
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
    if (centerFileInputRef.current) {
      centerFileInputRef.current.click();
    } else {
      setIsSidebarOpen(true);
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 80);
    }
  };

  // Core upload pipeline executed when a file is selected anywhere
  const uploadPdfFile = async (fileToUpload: File) => {
    // Client-side security pre-flight checks
    if (!fileToUpload) return;

    if (fileToUpload.size > 20 * 1024 * 1024) {
      setUploadStatus({
        type: 'error',
        message: `Security Reject: File exceeds maximum allowed size (20 MB). Selected file is ${(fileToUpload.size / (1024 * 1024)).toFixed(1)} MB.`,
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

      let data: UploadApiResponse | null = null;
      const text = await res.text();
      try {
        data = JSON.parse(text) as UploadApiResponse;
      } catch {
        // Not JSON formatted
      }

      if (res.ok && data?.success) {
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
            content: `**"${fileName}"** has been uploaded and indexed into ${totalChunks} vector chunks!\n\nI have analyzed its contents and generated tailored starter questions. Ask anything or pick a suggested topic below!`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);

        // On mobile, close sidebar automatically
        if (typeof window !== 'undefined' && window.innerWidth < 1024) {
          setIsSidebarOpen(false);
        }
      } else {
        const fallbackMsg =
          res.status === 413
            ? 'File is too large for serverless upload (Vercel max payload is 4.5MB).'
            : res.status === 504
              ? 'Server timed out while processing this document. Please try a smaller PDF.'
              : res.status !== 200
                ? `Server error (HTTP ${res.status}): ${text.slice(0, 120) || res.statusText || 'Upload failed'}`
                : 'Failed to parse and embed PDF.';

        setUploadStatus({
          type: 'error',
          message: data?.error || fallbackMsg,
        });
      }
    } catch (err: unknown) {
      console.error('Upload error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setUploadStatus({
        type: 'error',
        message: errMsg ? `Upload failed: ${errMsg}` : 'Network error occurred during upload. Please check your connection.',
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

      let data: AskApiResponse | null = null;
      const text = await res.text();
      try {
        data = JSON.parse(text) as AskApiResponse;
      } catch {
        // Not JSON formatted
      }

      const responseTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (res.ok && data?.success) {
        setChatLog(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.answer || '',
            sources: data.sources,
            timestamp: responseTime,
          },
        ]);
      } else {
        const errorContent =
          data?.error ||
          (res.status === 504
            ? 'The AI request timed out. Please try asking a more focused question.'
            : res.status !== 200
              ? `Server error (${res.status}): ${text.slice(0, 100) || res.statusText || 'Could not generate answer'}`
              : "I couldn't find relevant information in the uploaded document.");

        setChatLog(prev => [
          ...prev,
          {
            role: 'assistant',
            content: errorContent.startsWith('Error:') ? errorContent : `Error: ${errorContent}`,
            timestamp: responseTime,
          },
        ]);
      }
    } catch (err: unknown) {
      console.error('Ask error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setChatLog(prev => [
        ...prev,
        {
          role: 'assistant',
          content: errMsg
            ? `Query failed: ${errMsg}`
            : 'Network error occurred while fetching the answer. Please check your connection.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsUploading(false);
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
            className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all cursor-pointer flex-shrink-0 active:scale-95 shadow-sm ${isSidebarOpen
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
              className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer border border-transparent hover:border-rose-500/20"
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
                <span className="text-[10px] font-mono font-medium text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
                  Max: 20 MB
                </span>
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
                    <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                      <span>{formatFileSize(selectedFile.size)}</span>
                      <span className="text-slate-600">•</span>
                      <span className="text-cyan-300 font-medium">Max 20 MB</span>
                    </div>
                    <span className="inline-block text-[11px] text-indigo-400 hover:text-indigo-300 font-medium underline">
                      Change document
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs sm:text-sm font-medium text-slate-200">
                      <span className="text-indigo-400">Click to browse</span> or drop PDF
                    </p>
                    <p className="text-[11px] text-slate-400">
                      PDF format • <span className="text-cyan-300 font-medium">Max: 20 MB</span>
                    </p>
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

            {/* Quick Links / Guide & Developer */}
            <div className="pt-2 flex items-center justify-between gap-2 border-t border-white/[0.05]">
              <button
                onClick={() => {
                  setTutorialStep(0);
                  setShowTutorial(true);
                }}
                className="flex-1 py-2 px-2.5 rounded-xl text-[11px] font-medium text-slate-300 hover:text-cyan-300 bg-white/[0.03] hover:bg-cyan-500/10 border border-white/[0.06] hover:border-cyan-500/25 transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:scale-95 group"
                title="Open Interactive User Guide"
              >
                <svg className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                <span>User Guide</span>
              </button>
              <button
                onClick={() => setShowAboutModal(true)}
                className="flex-1 py-2 px-2.5 rounded-xl text-[11px] font-medium text-slate-300 hover:text-indigo-300 bg-white/[0.03] hover:bg-indigo-500/10 border border-white/[0.06] hover:border-indigo-500/25 transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:scale-95 group"
                title="About DocuMind AI & Developer"
              >
                <svg className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-110 transition-transform flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>About & Dev</span>
              </button>
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

                {/* Document Hub Upload & Process Component in Center Chat */}
                {!activeDocName ? (
                  <div className="w-full max-w-xl mx-auto mt-2">
                    <div className="rounded-2xl sm:rounded-3xl bg-slate-900/90 border border-white/[0.08] p-4 sm:p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden text-left">
                      {/* Top Glowing Accent Line */}
                      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500 opacity-80" />

                      {/* Card Header */}
                      <div className="flex items-center justify-between mb-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-bold border border-indigo-500/30">
                            1
                          </span>
                          <div>
                            <h4 className="font-semibold text-sm sm:text-base text-white">Upload & Process PDF</h4>
                            <p className="text-[11px] text-slate-400">Embed document chunks into vector database</p>
                          </div>
                        </div>

                        {/* Maximum Upload Size Badge */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-xs font-semibold font-mono shadow-sm shadow-cyan-500/10">
                          <svg className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span>Max: 20 MB</span>
                        </div>
                      </div>

                      {/* Dropzone Box */}
                      <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onClick={() => centerFileInputRef.current?.click()}
                        className={`relative cursor-pointer group rounded-xl sm:rounded-2xl border-2 border-dashed p-5 sm:p-7 transition-all duration-200 flex flex-col items-center justify-center text-center ${isDragging
                          ? 'border-indigo-400 bg-indigo-500/15 scale-[1.01]'
                          : selectedFile
                            ? 'border-emerald-500/40 bg-emerald-500/5'
                            : 'border-white/10 hover:border-indigo-500/50 hover:bg-white/[0.02]'
                          }`}
                      >
                        <input
                          ref={centerFileInputRef}
                          type="file"
                          name="file"
                          accept=".pdf"
                          onChange={handleFileChange}
                          className="hidden"
                        />

                        <div
                          className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 transition-transform duration-200 group-hover:scale-110 shadow-md ${selectedFile
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                            }`}
                        >
                          {selectedFile ? (
                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                          )}
                        </div>

                        {selectedFile ? (
                          <div className="space-y-1.5 w-full px-2">
                            <p className="text-sm sm:text-base font-semibold text-slate-100 truncate">
                              {selectedFile.name}
                            </p>
                            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                              <span className="font-mono text-cyan-300">{formatFileSize(selectedFile.size)}</span>
                              <span className="text-slate-600">•</span>
                              <span className="text-emerald-400 font-medium">Ready to embed</span>
                              <span className="text-slate-600">•</span>
                              <span className="text-slate-400">Max: 20 MB</span>
                            </div>
                            <span className="inline-block text-xs text-indigo-400 hover:text-indigo-300 font-medium underline mt-1">
                              Choose another PDF document
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <p className="text-xs sm:text-sm font-medium text-slate-200">
                              <span className="text-indigo-400 font-semibold group-hover:text-indigo-300">Click to browse</span> or drag & drop PDF here
                            </p>
                            <p className="text-[11px] sm:text-xs text-slate-400">
                              Accepts standard PDF documents • Maximum upload size: <strong className="text-cyan-300 font-semibold">20 MB</strong>
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Process & Embed Button */}
                      <div className="mt-3.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedFile) {
                              uploadPdfFile(selectedFile);
                            } else {
                              centerFileInputRef.current?.click();
                            }
                          }}
                          disabled={isUploading}
                          className={`w-full py-2.5 sm:py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-lg transition-all duration-200 cursor-pointer ${isUploading
                            ? 'bg-slate-800 text-slate-400 cursor-not-allowed border border-white/5'
                            : selectedFile
                              ? 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white shadow-indigo-500/25 active:scale-[0.99]'
                              : 'bg-indigo-600/80 hover:bg-indigo-600 text-white shadow-indigo-500/20 active:scale-[0.99]'
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
                              <span>Embedding Chunks & Vectorizing...</span>
                            </>
                          ) : selectedFile ? (
                            <>
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                              </svg>
                              <span>Process & Embed PDF</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                              </svg>
                              <span>Select PDF to Upload (Max 20 MB)</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Real-time Status Alert */}
                      {uploadStatus.message && (
                        <div
                          className={`mt-3 p-2.5 sm:p-3 rounded-xl text-xs flex items-start gap-2.5 border transition-all ${uploadStatus.type === 'loading'
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
                          <span className="leading-relaxed flex-1 break-words">{uploadStatus.message}</span>
                        </div>
                      )}

                      {/* Trust & Spec Badges */}
                      <div className="mt-3.5 pt-3 border-t border-white/[0.06] grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Max 20 MB size</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Malware check</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>768-dim vectors</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Page citations</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Dynamic Tailored Question Cards (Shown when document IS uploaded) */
                  suggestedQuestions.length > 0 && (
                    <div className="w-full max-w-xl mx-auto space-y-3 mt-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-semibold text-slate-400">Suggested Questions</span>
                        <button
                          type="button"
                          onClick={() => centerFileInputRef.current?.click()}
                          className="text-[11px] text-cyan-300 hover:text-cyan-200 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                          <span>Upload Different PDF (Max 20 MB)</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
                        {suggestedQuestions.map((q, idx) => (
                          <div
                            key={idx}
                            onClick={() => handlePromptClick(q)}
                            className="cursor-pointer p-3.5 rounded-xl bg-slate-900/60 hover:bg-indigo-500/10 border border-white/[0.08] hover:border-indigo-500/30 transition-all flex flex-col justify-between group shadow-sm"
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 flex items-center gap-1">
                                {idx === 0 ? (
                                  <>
                                    <svg className="w-3 h-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                      <polyline points="14 2 14 8 20 8" />
                                    </svg>
                                    <span>Executive Summary</span>
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-3 h-3 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <circle cx="12" cy="12" r="10" />
                                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                                      <line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                    <span>Question {idx + 1}</span>
                                  </>
                                )}
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

      {/* 1. Onboarding Interactive Tutorial Modal */}
      {showTutorial && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-xl bg-[#0c1220] border border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            {/* Top Glowing Decorative Accent */}
            <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500" />

            {/* Modal Header */}
            <div className="p-4 sm:p-6 pb-2 flex items-center justify-between border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                  {TUTORIAL_STEPS[tutorialStep].badge}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  {tutorialStep + 1} of {TUTORIAL_STEPS.length}
                </span>
              </div>
              <button
                onClick={handleCloseTutorial}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                title="Close Guide"
                aria-label="Close Guide"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 sm:p-7 space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500/20 via-violet-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center flex-shrink-0 shadow-inner">
                  {TUTORIAL_STEPS[tutorialStep].iconName === 'sparkles' && (
                    <svg className="w-6 h-6 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                  )}
                  {TUTORIAL_STEPS[tutorialStep].iconName === 'upload' && (
                    <svg className="w-6 h-6 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  )}
                  {TUTORIAL_STEPS[tutorialStep].iconName === 'cpu' && (
                    <svg className="w-6 h-6 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  )}
                  {TUTORIAL_STEPS[tutorialStep].iconName === 'chat' && (
                    <svg className="w-6 h-6 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                  )}
                  {TUTORIAL_STEPS[tutorialStep].iconName === 'keyboard' && (
                    <svg className="w-6 h-6 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M18 16H6" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                    {TUTORIAL_STEPS[tutorialStep].title}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300 mt-1 leading-relaxed">
                    {TUTORIAL_STEPS[tutorialStep].description}
                  </p>
                </div>
              </div>

              {/* Highlights Box */}
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3.5 space-y-2">
                {TUTORIAL_STEPS[tutorialStep].highlights.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 text-xs text-slate-300">
                    <span className="text-cyan-400 font-bold mt-0.5">✓</span>
                    <span className="leading-relaxed">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Dots indicator */}
            <div className="px-6 flex items-center justify-center gap-1.5 py-1">
              {TUTORIAL_STEPS.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setTutorialStep(idx)}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${idx === tutorialStep
                    ? 'w-6 bg-cyan-400 shadow-sm shadow-cyan-500/50'
                    : 'w-2 bg-white/20 hover:bg-white/40'
                    }`}
                  aria-label={`Go to step ${idx + 1}`}
                />
              ))}
            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 sm:p-6 pt-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/[0.06] bg-slate-900/40">
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none self-start sm:self-center">
                <input
                  type="checkbox"
                  checked={dontShowTutorialAgain}
                  onChange={e => setDontShowTutorialAgain(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 cursor-pointer"
                />
                <span>Don&apos;t show on startup</span>
              </label>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                {tutorialStep > 0 && (
                  <button
                    onClick={() => setTutorialStep(prev => prev - 1)}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-all cursor-pointer active:scale-95"
                  >
                    Previous
                  </button>
                )}

                {tutorialStep < TUTORIAL_STEPS.length - 1 ? (
                  <button
                    onClick={() => setTutorialStep(prev => prev + 1)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 shadow-md shadow-indigo-500/25 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                  >
                    <span>Next</span>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={handleCompleteTutorial}
                    className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 shadow-md shadow-emerald-500/25 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                  >
                    <span>Get Started</span>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Comprehensive About Project & Developer Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl max-h-[90vh] bg-[#0c1220] border border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            {/* Top Glowing Decorative Accent */}
            <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-violet-500" />

            {/* Modal Header */}
            <div className="p-4 sm:p-6 pb-3 flex items-center justify-between border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-indigo-600 to-cyan-400 p-[1px] shadow-md shadow-indigo-500/20">
                  <div className="w-full h-full bg-[#090d16] rounded-[10px] flex items-center justify-center">
                    <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                    DocuMind<span className="text-cyan-400">.ai</span>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                      About & Bio
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Retrieval-Augmented Generation Document Research Workspace
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowAboutModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                title="Close"
                aria-label="Close About Modal"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-white/[0.06] bg-slate-900/50 px-4 sm:px-6">
              <button
                onClick={() => setAboutActiveTab('project')}
                className={`py-3 px-3 sm:px-4 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${aboutActiveTab === 'project'
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
              >
                <svg className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span>Project Overview</span>
              </button>
              <button
                onClick={() => setAboutActiveTab('developer')}
                className={`py-3 px-3 sm:px-4 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${aboutActiveTab === 'developer'
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
              >
                <svg className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                <span>Developer Profile</span>
              </button>
              <button
                onClick={() => setAboutActiveTab('architecture')}
                className={`py-3 px-3 sm:px-4 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${aboutActiveTab === 'architecture'
                  ? 'border-violet-400 text-violet-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
              >
                <svg className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
                <span>Architecture</span>
              </button>
            </div>

            {/* Tab Content (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-5 text-slate-300 text-xs sm:text-sm">
              {/* TAB 1: PROJECT OVERVIEW */}
              {aboutActiveTab === 'project' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-white mb-1.5 flex items-center gap-2">
                      <svg className="w-4 h-4 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span>What is DocuMind AI?</span>
                    </h3>
                    <p className="text-slate-300 leading-relaxed">
                      DocuMind AI is an enterprise-grade, retrieval-augmented intelligence platform engineered to eliminate knowledge cutoffs and LLM hallucinations. Rather than asking a language model to guess answers, DocuMind AI grounds every response mathematically against the specific pages and sections of your uploaded documents.
                    </p>
                  </div>

                  {/* Core Value Pillars */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-white text-xs">
                        <span className="text-emerald-400">✓</span> 100% Free-Tier Architecture
                      </div>
                      <p className="text-[11.5px] text-slate-400 leading-relaxed">
                        Runs on Next.js 16, Google Gemini 3.5 Flash, Supabase pgvector, and Vercel Serverless—zero credit cards or paid APIs required.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-white text-xs">
                        <span className="text-cyan-400">✓</span> Zero Native Dependencies
                      </div>
                      <p className="text-[11.5px] text-slate-400 leading-relaxed">
                        Powered by <code className="text-cyan-300">unpdf</code>, guaranteeing reliable serverless PDF parsing across Vercel, Node, and Edge without native C++ binary crashes.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-white text-xs">
                        <span className="text-indigo-400">✓</span> Dual-Tier Storage Resilience
                      </div>
                      <p className="text-[11.5px] text-slate-400 leading-relaxed">
                        Primary vector storage in PostgreSQL pgvector with instant, zero-latency automatic fallback to local vector indexing.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-white text-xs">
                        <span className="text-rose-400">✓</span> Enterprise Security Suite
                      </div>
                      <p className="text-[11.5px] text-slate-400 leading-relaxed">
                        Binary magic bytes validation (%PDF-), anti-malware exploit blocking (/Launch), sliding-window rate limiting, and prompt injection defense.
                      </p>
                    </div>
                  </div>

                  {/* Links */}
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <a
                      href="https://github.com/Basiibnumoideen/chat-with-pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-white/10 transition-all cursor-pointer shadow-sm"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                      <span>GitHub Repository</span>
                    </a>


                  </div>
                </div>
              )}

              {/* TAB 2: DEVELOPER PROFILE */}
              {aboutActiveTab === 'developer' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-indigo-500/10 via-indigo-600/5 to-cyan-500/10 border border-indigo-500/20">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-cyan-400 p-[2px] flex-shrink-0 shadow-md">
                      <div className="w-full h-full bg-[#0a0f1d] rounded-[14px] flex items-center justify-center font-bold text-xl text-white">
                        MB
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                          Muhammed Abdul Basith
                        </h3>
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                          Full Stack Developer
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        <span>Malappuram, Kerala, India • AI & Vector RAG Architect</span>
                      </p>
                    </div>
                  </div>

                  {/* Summary & Education */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      Professional Background
                    </h4>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Entry-level Full Stack Developer proficient in the MERN stack (MongoDB, Express, React, Node.js), Next.js, and Python/Django web development. Passionate about engineering high-performance AI-assisted web platforms, vector retrieval systems, and clean software architecture.
                    </p>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] text-xs text-slate-400 flex items-center gap-2">
                      <svg className="w-4 h-4 text-indigo-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                        <path d="M6 12v5c3 3 9 3 12 0v-5" />
                      </svg>
                      <span>
                        <strong className="text-white">B.Sc. in Computer Science</strong> — Calicut University (Regional College of Science and Humanities)
                      </span>
                    </div>
                  </div>

                  {/* Tech Stack Pills */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      Technical Competencies
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        'Next.js 16 (App Router)',
                        'React 19',
                        'TypeScript',
                        'Node.js',
                        'Python & Django',
                        'MERN Stack',
                        'Supabase (pgvector)',
                        'Google Gemini API',
                        'Tailwind CSS v4',
                        'unpdf Vector Parser',
                        'MongoDB & MySQL',
                        'Git & GitHub',
                        'Vercel Serverless',
                        'Cursor & Copilot',
                      ].map((skill, sIdx) => (
                        <span
                          key={sIdx}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/[0.04] border border-white/[0.08] text-slate-300 hover:text-white hover:border-indigo-500/40 transition-colors"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Contact Badges & Actions */}
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <a
                      href="mailto:basiibnumoideen@gmail.com"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/25 transition-all cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect width="20" height="16" x="2" y="4" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                      <span>basiibnumoideen@gmail.com</span>
                    </a>

                    <button
                      onClick={handleCopyEmail}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-all cursor-pointer flex items-center gap-1 active:scale-95"
                      title="Copy email to clipboard"
                    >
                      {copiedEmail ? (
                        <>
                          <span className="text-emerald-400">✓</span>
                          <span>Copied!</span>
                        </>
                      ) : (
                        <span>Copy Email</span>
                      )}
                    </button>

                    <a
                      href="https://github.com/Basiibnumoideen"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-all cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                      <span>GitHub Profile</span>
                    </a>
                  </div>
                </div>
              )}

              {/* TAB 3: ARCHITECTURE */}
              {aboutActiveTab === 'architecture' && (
                <div className="space-y-4">
                  <h3 className="text-sm sm:text-base font-bold text-white mb-1.5 flex items-center gap-2">
                    <svg className="w-4 h-4 text-violet-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    <span>End-to-End RAG Architecture</span>
                  </h3>

                  <div className="space-y-2.5">
                    {[
                      {
                        step: '1',
                        title: 'Binary Upload & Anti-Malware Validation',
                        desc: 'Validates multipart payload, enforces 20MB cap, verifies %PDF- binary magic bytes, sanitizes filenames, and scans for embedded /Launch exploit strings.',
                      },
                      {
                        step: '2',
                        title: 'Zero-Native Text Extraction via unpdf',
                        desc: 'Leverages serverless-native unpdf to extract page-by-page text streams without relying on C++ canvas binaries or heavy worker threads.',
                      },
                      {
                        step: '3',
                        title: 'Contextual Semantic Chunking',
                        desc: 'Splits text into ~350-word sliding window chunks with 60-word cross-boundary overlap. Injects metadata prefix: "Document: {name} | Page: {num}".',
                      },
                      {
                        step: '4',
                        title: 'Gemini 768-Dim Vector Embeddings',
                        desc: 'Concurrently embeds chunks in batches of 5 using Gemini embedding models, producing normalized 768-dimensional mathematical coordinates.',
                      },
                      {
                        step: '5',
                        title: 'Hybrid Similarity Retrieval Engine',
                        desc: 'Combines 70% dense vector cosine distance with 30% lexical keyword matching to ensure both semantic breadth and exact term precision.',
                      },
                      {
                        step: '6',
                        title: 'Grounded Synthesis with Page Attribution',
                        desc: 'Gemini 3.5 Flash generates structured responses with bullet points, bold concepts, and exact bracketed page citations [Page X].',
                      },
                    ].map(stage => (
                      <div
                        key={stage.step}
                        className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]"
                      >
                        <span className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                          {stage.step}
                        </span>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-white text-xs">{stage.title}</h4>
                          <p className="text-[11.5px] text-slate-400 mt-0.5 leading-relaxed">{stage.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 border-t border-white/[0.06] bg-slate-900/40 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">DocuMind AI • Developed by Muhammed Abdul Basith</span>
              <button
                onClick={() => setShowAboutModal(false)}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-white/10 transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}