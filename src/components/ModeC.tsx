import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Upload, CheckCircle2, Loader2, X, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { conductDialogueStep, DialogueStep } from '../agents/LLMProvider';
import { runMasterAnalysis, runParallelAnalysis, AgentEvent } from '../services/ai';
import AnalysisDashboard from './AnalysisDashboard';
import { AnalysisResult } from '../types';

const INTRO =
  "Hello! I'm Echo — an autonomous multi-agent financial intelligence system.\n\n" +
  "I specialise in analysing financial reports and listed company data: valuation models, " +
  "ESG profiles, strategic risks, peer comparisons, and investment verdicts.\n\n" +
  "What would you like to analyse today?";

interface Message {
  role: 'assistant' | 'user';
  content: string;
}

interface ConfirmedPlan {
  ticker: string;
  companyName: string;
  aspects: string[];
  needsPDF: boolean;
  planSummary: string;
}

type Phase = 'chatting' | 'awaiting_confirm' | 'awaiting_pdf' | 'analyzing' | 'done';

function mergePartial(acc: Partial<AnalysisResult>, incoming: Partial<AnalysisResult>): Partial<AnalysisResult> {
  const merged = { ...acc, ...incoming };
  if (acc.metrics && incoming.metrics) {
    const seen = new Set(acc.metrics.map(m => m.label));
    merged.metrics = [...acc.metrics, ...incoming.metrics.filter(m => !seen.has(m.label))];
  }
  if (acc.highlights && incoming.highlights) {
    const seen = new Set(acc.highlights.map(h => h.trim()));
    merged.highlights = [...acc.highlights, ...incoming.highlights.filter(h => !seen.has(h.trim()))];
  }
  if (acc.risks && incoming.risks) {
    const seen = new Set(acc.risks.map(r => r.trim()));
    merged.risks = [...acc.risks, ...incoming.risks.filter(r => !seen.has(r.trim()))];
  }
  return merged;
}

export default function ModeC() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: INTRO }
  ]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('chatting');
  const [plan, setPlan] = useState<ConfirmedPlan | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [partialData, setPartialData] = useState<Partial<AnalysisResult>>({});
  const [thinking, setThinking] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Show dashboard as soon as the first company info arrives (even mid-analysis)
  const showDashboard = !!partialData.company;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, phase, thinking]);

  const handleEvent = useCallback((evt: AgentEvent) => {
    setAgentStatus(evt);
    if (evt.partial) {
      setPartialData(prev => mergePartial(prev, evt.partial!));
    }
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || thinking || phase !== 'chatting') return;

    const userMsg: Message = { role: 'user', content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setThinking(true);
    setError(null);

    try {
      const step: DialogueStep = await conductDialogueStep(
        updated.map(m => ({ role: m.role, content: m.content }))
      );

      if (step.type === 'question') {
        setMessages(prev => [...prev, { role: 'assistant', content: step.content }]);
      } else {
        const planMsg =
          `Based on our conversation, here's my analysis plan:\n\n` +
          `${step.planSummary}\n\n` +
          `**Company:** ${step.companyName} (${step.ticker})\n` +
          `**Sections:** ${step.aspects.join(', ') || 'full analysis'}\n` +
          `**PDF required:** ${step.needsPDF ? 'Yes — please upload below' : 'No — market data only'}\n\n` +
          `Shall I proceed?`;
        setMessages(prev => [...prev, { role: 'assistant', content: planMsg }]);
        setPlan(step);
        setPhase('awaiting_confirm');
      }
    } catch (err: any) {
      setError('Failed to get response: ' + (err.message || 'unknown error'));
    } finally {
      setThinking(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleConfirm = () => {
    if (!plan) return;
    if (plan.needsPDF) {
      setPhase('awaiting_pdf');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Please upload the financial report PDF to proceed with the analysis.'
      }]);
    } else {
      runAgents();
    }
  };

  const handleReject = () => {
    setPhase('chatting');
    setPlan(null);
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: "No problem — let me ask a couple more questions to refine the plan. What would you like to change?"
    }]);
  };

  const handleFile = (f: File) => {
    if (f.type !== 'application/pdf') { setError('Please upload a PDF file.'); return; }
    if (f.size > 20 * 1024 * 1024) { setError('File too large (max 20 MB).'); return; }
    setFile(f);
    setError(null);
    setMessages(prev => [...prev, { role: 'user', content: `Uploaded: ${f.name}` }]);
    setTimeout(() => runAgents(f), 200);
  };

  const runAgents = async (pdfFile?: File) => {
    if (!plan) return;
    setPhase('analyzing');
    setPartialData({});
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Starting analysis for ${plan.companyName} (${plan.ticker})…`
    }]);

    try {
      const usedFile = pdfFile || file;
      let final: AnalysisResult;

      if (usedFile) {
        // PDF-first: ticker is extracted from the document automatically
        final = await runParallelAnalysis(usedFile, plan.aspects, handleEvent);
      } else {
        final = await runMasterAnalysis(
          { ticker: plan.ticker, options: plan.aspects },
          handleEvent
        );
      }
      // Safety net: merge final result in case any section was missed by streaming
      setPartialData(prev => mergePartial(prev, final));
      setPhase('done');
    } catch (err: any) {
      setError(err.message || 'Analysis failed. Please try again.');
      setPhase('awaiting_confirm');
    } finally {
      setAgentStatus(null);
    }
  };

  const handleReset = () => {
    setPartialData({});
    setPhase('chatting');
    setMessages([{ role: 'assistant', content: INTRO }]);
    setPlan(null);
    setFile(null);
    setError(null);
    setAgentStatus(null);
  };

  // ── Dashboard: shown as soon as first company data arrives ────────────────
  if (showDashboard) {
    return (
      <div className="flex-1 overflow-y-auto p-8">
        <AnalysisDashboard
          data={partialData}
          isLoading={phase === 'analyzing'}
          onReset={handleReset}
          onError={(msg) => setError(msg)}
        />
      </div>
    );
  }

  // ── Chat interface ────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Mode badge */}
      <div className="px-6 pt-4 pb-2 shrink-0">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold uppercase tracking-widest">
          <Zap className="w-3 h-3" /> Mode C — AI Dialogue
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              msg.role === 'assistant'
                ? 'bg-indigo-500/20 border border-indigo-500/30'
                : 'bg-slate-700 border border-slate-600'
            }`}>
              {msg.role === 'assistant'
                ? <Bot className="w-4 h-4 text-indigo-400" />
                : <User className="w-4 h-4 text-slate-300" />
              }
            </div>
            <div className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'assistant'
                ? 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-sm'
                : 'bg-indigo-600 text-white rounded-tr-sm'
            }`}>
              {msg.content}
            </div>
          </motion.div>
        ))}

        {/* Thinking indicator */}
        {thinking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
              <span className="text-slate-500 text-sm">Thinking…</span>
            </div>
          </div>
        )}

        {/* Confirm / Adjust buttons */}
        {phase === 'awaiting_confirm' && plan && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3 ml-11"
          >
            <button
              onClick={handleConfirm}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl transition-all shadow-[0_0_12px_rgba(99,102,241,0.3)]"
            >
              ✓ Looks good — start analysis
            </button>
            <button
              onClick={handleReject}
              className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl transition-all border border-slate-700"
            >
              ↩ Adjust
            </button>
          </motion.div>
        )}

        {/* PDF upload prompt */}
        {phase === 'awaiting_pdf' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="ml-11"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {file ? (
              <div className="flex items-center gap-3 p-3 bg-indigo-950/30 border border-indigo-500/30 rounded-xl max-w-xs">
                <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="text-sm text-white truncate">{file.name}</span>
                <button onClick={() => setFile(null)} className="ml-auto text-slate-500 hover:text-rose-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-3 px-5 py-3 bg-slate-900 border border-slate-700 hover:border-indigo-500/40 hover:bg-slate-800 rounded-xl text-sm text-slate-300 transition-all"
              >
                <Upload className="w-4 h-4 text-indigo-400" />
                Click to upload PDF report
              </button>
            )}
          </motion.div>
        )}

        {/* Agent status while analyzing */}
        {phase === 'analyzing' && agentStatus && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="ml-11 flex items-center gap-3 bg-slate-900 border border-indigo-500/20 rounded-xl px-4 py-3 max-w-sm"
          >
            <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mr-2">{agentStatus.agent}</span>
              <span className="text-sm text-slate-300 truncate">{agentStatus.status}</span>
            </div>
          </motion.div>
        )}

        {error && <p className="ml-11 text-rose-400 text-sm">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Input bar — only shown during active chat */}
      {phase === 'chatting' && (
        <div className="shrink-0 p-4 border-t border-slate-800/60 bg-[#080a0f]/80 backdrop-blur-sm">
          <div className="flex gap-3 max-w-3xl mx-auto">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Type your response…"
              disabled={thinking}
              className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 outline-none transition-all text-sm disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || thinking}
              className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
