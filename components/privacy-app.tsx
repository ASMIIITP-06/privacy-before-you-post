'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, AudioLines, Check, ChevronDown, CircleAlert, Clock3, Copy, Eye, EyeOff, FileArchive, FileImage, FileText, Film, Globe2, History, LockKeyhole, Plus, RotateCcw, ScanSearch, Scissors, Shield, Sparkles, Trash2, Upload, X, Zap,
} from 'lucide-react';
import { analyzePrivacy, AnalysisResult, AnalysisSource, Classification, PrivacyFinding } from '@/lib/privacy/analyzer';
import { extractPdfText, PdfExtraction, SCANNED_PDF_MESSAGE } from '@/lib/pdf/extract-pdf';
import { VideoStudio } from './studio/video-studio';
import { AuthGate } from './auth/auth-gate';
import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

type AppView = 'home' | 'analyze' | 'results' | 'editor' | 'closed' | 'studio';
type PdfReadState = { status: 'reading' } | { status: 'ready'; extraction: PdfExtraction } | { status: 'error'; message: string };
type QueueFile = { id: string; file: File; preview?: string; kind: string; status: string; pdf?: PdfReadState };
type Session = { id: string; createdAt: number; expiresAt: number };
type SocialPost = { caption: string; hashtags: string; location: string; altText: string };
type ScoreHistoryItem = { version: number; score: number; classification: Classification; createdAt: number };

type Demo = { name: string; description: string; text: string };
type SubmittedInput = { label: string; text: string };

const demos: Demo[] = [
  { name: 'Safe caption', description: 'A low-risk everyday post', text: 'A quiet afternoon reading by the window.' },
  { name: 'Campus post', description: 'Location and routine clues', text: 'Another late night at ABC Institute Cyber Lab. Tomorrow\'s 10 AM exam is going to be brutal. #college #coding' },
  { name: 'High-risk post', description: 'A fictional example with direct identifiers', text: 'Meet me at the hostel gate at 8:30 PM. Call +1 555 010 2026 or email rahul@example.com. Student ID: ABC20261234' },
  { name: 'Multi-file attack surface', description: 'See how clues combine', text: 'Rahul presenting our project at Northbridge University next Friday at 8 PM.' },
];

function createSession(): Session {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const id = `PBYP-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return { id, createdAt: Date.now(), expiresAt: Date.now() + 30 * 60 * 1000 };
}

function kindForFile(file: File): string {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) return 'pdf';
  if (/\.(docx?|pptx?|xlsx?|csv|rtf|odt|md|txt)$/i.test(file.name)) return 'document';
  return 'file';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pdfStatus(pdf: PdfReadState): { label: string; tone: 'ok' | 'warn' | 'error' | 'pending' } {
  if (pdf.status === 'reading') return { label: 'Reading', tone: 'pending' };
  if (pdf.status === 'error') return { label: 'Unreadable', tone: 'error' };
  if (pdf.extraction.scanned) return { label: 'Scanned', tone: 'warn' };
  return { label: 'Readable', tone: 'ok' };
}

function pdfSource(item: QueueFile): AnalysisSource {
  const pdf = item.pdf;
  if (pdf?.status === 'ready') return { name: item.file.name, kind: 'pdf', pages: pdf.extraction.pages, readError: pdf.extraction.scanned ? SCANNED_PDF_MESSAGE : undefined };
  return { name: item.file.name, kind: 'pdf', readError: pdf?.status === 'error' ? pdf.message : 'This PDF is still being read.' };
}

function scoreColor(score: number): string {
  if (score <= 20) return 'text-emerald-300';
  if (score <= 50) return 'text-amber-300';
  return 'text-rose-300';
}

function severityClass(severity: PrivacyFinding['severity']): string {
  return severity === 'CRITICAL' ? 'critical' : severity === 'HIGH' ? 'high' : severity === 'MEDIUM' ? 'medium' : 'low';
}

function Header({ session, user, onStart, onEnd, onNavigate, onSection, onSignOut }: { session: Session | null; user: User; onStart: () => void; onEnd: () => void; onNavigate: (view: AppView) => void; onSection: (id: string) => void; onSignOut: () => void }): JSX.Element {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate('home')} aria-label="Go home">
        <span className="brand-mark"><Shield size={18} strokeWidth={2.5} /></span>
        <span>Privacy Before You Post</span>
      </button>
      <nav className="nav-links" aria-label="Main navigation">
        <button onClick={() => onNavigate('analyze')}>Analyze</button>
        <button onClick={() => onSection('how')}>How it works</button>
        <button onClick={() => onSection('demo')}>Try a demo</button>
      </nav>
      <div className="header-actions"><span className="account-email" title={user.email}>{user.email}</span><button className="button small outline" onClick={onSignOut}>Sign out</button>
        {session ? <span className="session-pill"><span className="live-dot" /> PRIVATE SESSION <b>{session.id}</b></span> : null}
        {session ? <button className="button small outline" onClick={onEnd}>End session</button> : <button className="button small primary" onClick={onStart}>Start private check <ArrowRight size={14} /></button>}
      </div>
    </header>
  );
}

function SideRail({ view, onNavigate }: { view: AppView; onNavigate: (view: AppView) => void }): JSX.Element {
  const items: Array<{ view: AppView; label: string; icon: typeof Upload }> = [
    { view: 'analyze', label: 'Upload', icon: Upload },
    { view: 'results', label: 'Results', icon: ScanSearch },
    { view: 'editor', label: 'Editor', icon: Scissors },
    { view: 'studio', label: 'Video Scan', icon: Film },
  ];
  return <aside className="side-rail">{items.map(({ view: itemView, label, icon: Icon }) => <button key={itemView} className={view === itemView ? 'active' : ''} onClick={() => onNavigate(itemView)}><Icon size={15} /> {label}</button>)}<div className="rail-spacer" /><div className="rail-note"><LockKeyhole size={14} /><span>Private by design</span></div></aside>;
}

function Home({ onStart, onDemo, onSection }: { onStart: () => void; onDemo: (demo: Demo) => void; onSection: (id: string) => void }): JSX.Element {
  return <main className="home-page">
    <section className="hero container">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> PRIVATE BY DEFAULT</div>
        <h1>Before the internet sees it, let AI <span>check it.</span></h1>
        <p className="hero-lede">Understand what your photos, documents, captions, and notes might reveal before you share them online.</p>
        <div className="hero-actions"><button className="button primary large" onClick={onStart}>Start private check <ArrowRight size={17} /></button><button className="button ghost large" onClick={() => onSection('how')}><Globe2 size={16} /> See how it works</button></div>
        <div className="trust-row"><span><Check size={14} /> No account required</span><span><Check size={14} /> Local-first analysis</span><span><Check size={14} /> You stay in control</span></div>
      </div>
      <div className="hero-visual"><div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="shield-orb"><Shield size={76} strokeWidth={1.3} /></div><div className="signal-card card-one"><FileImage size={17} /><span>Photo scan</span><b>Ready</b></div><div className="signal-card card-two"><LockKeyhole size={17} /><span>Private</span><b>30 min</b></div><div className="signal-card card-three"><CircleAlert size={17} /><span>Context clues</span><b>Explained</b></div></div>
    </section>
    <section id="how" className="how-section container"><div className="section-kicker">A clearer way to share</div><h2>Small clues can say a lot.</h2><p className="section-intro">Privacy Before You Post turns the invisible parts of your content into decisions you can actually make.</p><div className="feature-grid">{[['01', 'Detect', 'Names, IDs, contact details, signs, and metadata.'], ['02', 'Connect', 'Location, identity, timing, and routine clues across files.'], ['03', 'Explain', 'Plain-language findings instead of a mysterious score.'], ['04', 'Fix', 'Specific recommendations and a safer version to review.']].map(([number, title, text]) => <div className="feature-card" key={number}><span>{number}</span><Zap size={20} /><h3>{title}</h3><p>{text}</p></div>)}</div></section>
    <section id="demo" className="demo-section container"><div><div className="section-kicker">See it in action</div><h2>Try a private demo.</h2><p>Start with a fictional example. Nothing is published, and the local checker works without an AI key.</p></div><div className="demo-grid">{demos.map((demo) => <button className="demo-card" key={demo.name} onClick={() => onDemo(demo)}><span>{demo.name}</span><small>{demo.description}</small><ArrowRight size={16} /></button>)}</div></section>
  </main>;
}

function UploadZone({ onFiles }: { onFiles: (files: File[]) => void }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); onFiles(Array.from(event.dataTransfer.files)); };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ''; };
  return <div className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') inputRef.current?.click(); }}><input ref={inputRef} type="file" multiple hidden onChange={handleChange} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.rtf,.odt" /><div className="upload-icon"><Upload size={24} /></div><h3>Drop content here</h3><p>or click to browse</p><small>Images · video · audio · PDF · documents · text</small></div>;
}

function MediaPreview({ item }: { item: QueueFile }): JSX.Element | null {
  const [duration, setDuration] = useState<number | null>(null);
  if (!item.preview || !['image', 'video', 'audio'].includes(item.kind)) return null;
  const formatTime = (seconds: number): string => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  return <div className="media-preview"><div className="media-preview-heading"><span>{item.kind.toUpperCase()} PREVIEW</span><small>{formatBytes(item.file.size)}{duration !== null ? ` · ${formatTime(duration)}` : ''}</small></div>{item.kind === 'image' && <img src={item.preview} alt={`Preview of ${item.file.name}`} />}{item.kind === 'video' && <video src={item.preview} controls preload="metadata" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} />}{item.kind === 'audio' && <audio src={item.preview} controls preload="metadata" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} />}</div>;
}

function AnalyzeView({ queue, onFiles, onRemove, text, setText, social, setSocial, onAnalyze, onDemo, analysisStatus, analysisProgress, onNavigate }: { queue: QueueFile[]; onFiles: (files: File[]) => void; onRemove: (id: string) => void; text: string; setText: (value: string) => void; social: SocialPost; setSocial: (value: SocialPost) => void; onAnalyze: () => void; onDemo: (demo: Demo) => void; analysisStatus: string | null; analysisProgress: number; onNavigate: (view: AppView) => void }): JSX.Element {
  const [mode, setMode] = useState<'upload' | 'text' | 'social'>('upload');
  const updateSocial = (field: keyof SocialPost, value: string) => setSocial({ ...social, [field]: value });
  return <div className="workspace"><SideRail view="analyze" onNavigate={onNavigate} /><main className="workspace-main"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> PRIVATE WORKSPACE</div><h1>What are you about to share?</h1><p>Choose a mode, add your content, and see the privacy clues before they leave your screen.</p></div><span className="expiration"><Clock3 size={14} /> Session expires in 30 min</span></div><div className="mode-tabs" role="tablist" aria-label="Content type"><button type="button" role="tab" aria-selected={mode === 'upload'} className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}><Upload size={15} /> Upload anything</button><button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}><FileText size={15} /> Text / note</button><button type="button" role="tab" aria-selected={mode === 'social'} className={mode === 'social' ? 'active' : ''} onClick={() => setMode('social')}><Globe2 size={15} /> Social post</button></div><div className={`workspace-grid ${mode === 'upload' ? 'single' : ''}`}>{mode === 'upload' && <section className="panel upload-panel"><UploadZone onFiles={onFiles} /><div className="supported"><span>Supported content</span><b>JPG</b><b>PNG</b><b>MP4</b><b>PDF</b><b>DOCX</b><b>TXT</b><b>CSV</b></div></section>}{mode !== 'upload' && <section className="panel text-panel"><div className="panel-header"><div><span className="section-kicker">{mode === 'text' ? 'TEXT / NOTE' : 'SOCIAL POST'}</span><h2>{mode === 'text' ? 'Add context' : 'Describe your post'}</h2></div><Sparkles size={18} /></div>{mode === 'text' && <><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Write a caption, note, or message you are planning to share..." /><div className="text-hint">Try a demo below, or add your own text.</div></>}{mode === 'social' && <div className="social-fields"><input value={social.caption} onChange={(event) => updateSocial('caption', event.target.value)} placeholder="Caption" /><div className="social-row"><input value={social.hashtags} onChange={(event) => updateSocial('hashtags', event.target.value)} placeholder="#hashtags" /><input value={social.location} onChange={(event) => updateSocial('location', event.target.value)} placeholder="Location" /></div><input value={social.altText} onChange={(event) => updateSocial('altText', event.target.value)} placeholder="Alt text" /></div>}</section>}</div>{queue.length > 0 && <section className="panel queue-panel"><div className="panel-header"><div><span className="section-kicker">YOUR CONTENT</span><h2>{queue.length} item{queue.length === 1 ? '' : 's'} ready</h2></div><span className="ready-label"><Check size={14} /> Ready to analyze</span></div><div className="queue-list">{queue.map((item) => <div className="queue-item" key={item.id}>{item.preview ? <img src={item.preview} alt="" /> : <div className="file-type"><FileArchive size={18} /></div>}<div className="queue-details"><b>{item.file.name}</b><span>{item.kind.toUpperCase()} · {formatBytes(item.file.size)}{item.pdf?.status === 'ready' ? ` · ${item.pdf.extraction.pageCount} ${item.pdf.extraction.pageCount === 1 ? 'page' : 'pages'}` : ''}</span>{item.pdf?.status === 'ready' && item.pdf.extraction.scanned && <small className="queue-notice">{SCANNED_PDF_MESSAGE} OCR is required to read scanned pages.</small>}{item.pdf?.status === 'error' && <small className="queue-notice">{item.pdf.message}</small>}</div>{item.pdf ? <span className={`status-dot tone-${pdfStatus(item.pdf).tone}`}>{pdfStatus(item.pdf).label}</span> : <span className="status-dot"><Check size={12} /> Ready</span>}<button onClick={() => onRemove(item.id)} aria-label={`Remove ${item.file.name}`}><X size={15} /></button></div>)}</div><div className="media-preview-grid">{queue.map((item) => <MediaPreview item={item} key={`preview-${item.id}`} />)}</div></section>}{queue.length === 0 && <div className="empty-state"><FileText size={18} /><span>No files yet. Add text, upload a file, or try a demo.</span></div>}{analysisStatus && <section className="panel analysis-progress"><div className="panel-header"><div><span className="section-kicker">LIVE ANALYSIS</span><h2>{analysisStatus}</h2></div><span>{analysisProgress}%</span></div><div className="analysis-progress-track"><i style={{ width: `${analysisProgress}%` }} /></div><div className="progress-steps"><span><Check size={13} /> Content prepared</span><span className={analysisProgress >= 65 ? 'done' : ''}>{analysisProgress >= 65 ? <Check size={13} /> : <Clock3 size={13} />} Local rules applied</span><span className={analysisProgress >= 90 ? 'done' : ''}>{analysisProgress >= 90 ? <Check size={13} /> : <Clock3 size={13} />} Findings scored</span></div></section>}<div className="analyze-footer"><div><LockKeyhole size={15} /><span>Private session · content is held in browser memory</span></div><button className="button primary large" disabled={analysisStatus !== null || queue.some((item) => item.pdf?.status === 'reading') || (queue.length === 0 && !text.trim() && !Object.values(social).some(Boolean))} onClick={onAnalyze}>{analysisStatus ? 'Analyzing…' : 'Analyze content'} <ArrowRight size={17} /></button></div><div className="demo-strip"><span>Quick start</span>{demos.map((demo) => <button key={demo.name} onClick={() => onDemo(demo)}>{demo.name}<ArrowRight size={13} /></button>)}</div></main></div>;
}

function SubmittedItem({ input }: { input: SubmittedInput }): JSX.Element {
  const [visible, setVisible] = useState(false);
  return <div className="submitted-item"><div className="submitted-head"><b>{input.label}</b><button className="button small outline" onClick={() => setVisible(!visible)} aria-expanded={visible}>{visible ? <EyeOff size={13} /> : <Eye size={13} />} {visible ? 'Hide' : 'Show'}</button></div>{visible ? <p>{input.text}</p> : <p className="submitted-masked">Hidden. Choose Show to reveal what you wrote.</p>}</div>;
}

function ScoreRing({ score }: { score: number }): JSX.Element { return <div className={`score-ring ${score <= 20 ? 'safe' : score <= 50 ? 'review' : 'risk'}`}><div><strong>{score}</strong><span>/ 100</span></div></div>; }

function ResultsView({ result, history, submitted, onEditor, onRecheck, onNewAnalysis, onNavigate }: { result: AnalysisResult | null; history: ScoreHistoryItem[]; submitted: SubmittedInput[]; onEditor: () => void; onRecheck: () => void; onNewAnalysis: () => void; onNavigate: (view: AppView) => void }): JSX.Element {
  if (!result) return <div className="empty-view"><ScanSearch size={34} /><h2>No analysis yet</h2><p>Add content to see your privacy intelligence report.</p><button className="button primary" onClick={onNewAnalysis}>Start analysis</button></div>;
  return <div className="workspace"><SideRail view="results" onNavigate={onNavigate} /><main className="workspace-main"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> PRIVACY INTELLIGENCE</div><h1>Your privacy report</h1><p>Here is what your content may reveal before it goes public.</p></div><button className="button outline" onClick={onNewAnalysis}><Plus size={15} /> New check</button></div><section className="score-grid"><div className="panel score-panel"><ScoreRing score={result.score} /><div><span className="section-kicker">PRIVACY SCORE</span><h2 className={scoreColor(result.score)}>{result.classification}</h2><p>{result.findings.length} potential exposure{result.findings.length === 1 ? '' : 's'} detected across {result.sources.length} source{result.sources.length === 1 ? '' : 's'}.</p></div></div><div className="panel decision-panel"><span className="decision-label"><CircleAlert size={15} /> {result.classification === 'SAFE' ? 'LOW EXPOSURE' : 'REVIEW BEFORE POSTING'}</span><h3>Keep the context, lose the clues.</h3><p>Recommendations are based on deterministic local checks. The final call stays with you.</p><button className="button primary" onClick={onEditor}>Edit & make it safer <Scissors size={15} /></button></div></section>{result.unreadable.length > 0 && <section className="panel unreadable-panel"><div className="panel-header"><div><span className="section-kicker">NOT FULLY READ</span><h2>Files we could not read</h2></div></div><ul className="unreadable-list">{result.unreadable.map((item) => <li key={item.name}><b>{item.name}</b><span>{item.reason}</span></li>)}</ul></section>}<section className="panel breakdown-panel"><div className="panel-header"><div><span className="section-kicker">EXPLAINABLE FINDINGS</span><h2>What we noticed</h2></div><span className="muted-text">Local analysis · {new Date(result.analyzedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div className="findings-grid">{result.findings.length ? result.findings.map((finding) => <FindingCard finding={finding} key={finding.id} />) : <div className="success-callout"><Check size={19} /><div><b>{result.unreadable.length > 0 ? 'Not everything could be read' : 'No obvious clues detected'}</b><p>{result.unreadable.length > 0 ? 'Some files had no readable text, so they still need a manual check before posting.' : 'That does not guarantee zero risk, but this content looks ready for a human review.'}</p></div></div>}</div></section><section className="insight-grid"><div className="panel inference-panel"><div className="section-kicker">WHAT SOMEONE COULD INFER</div><h2>Possible inferences</h2><ul>{result.inferences.map((inference) => <li key={inference}><span><Check size={13} /></span>{inference}</li>)}</ul></div><div className="panel recommendation-panel"><div className="section-kicker">RECOMMENDATIONS</div><h2>Before you post</h2><ul>{result.recommendations.length ? result.recommendations.map((recommendation) => <li key={recommendation}><ArrowRight size={14} />{recommendation}</li>) : <li><Check size={14} />No changes suggested by the local checker.</li>}</ul></div></section><section className="panel history-panel"><div className="panel-header"><div><span className="section-kicker">SCORE HISTORY</span><h2>Private session versions</h2></div><History size={18} /></div><div className="history-list">{history.map((item) => <div className="history-item" key={`${item.version}-${item.createdAt}`}><span>Version {item.version}</span><b className={scoreColor(item.score)}>{item.score}</b><small>{item.classification}</small></div>)}</div></section>{submitted.length > 0 && <section className="panel submitted-panel"><div className="panel-header"><div><span className="section-kicker">YOUR SUBMITTED TEXT</span><h2>What you wrote</h2></div></div><div className="submitted-list">{submitted.map((input) => <SubmittedItem input={input} key={input.label} />)}</div></section>}<div className="results-actions"><button className="button outline" onClick={onRecheck}><RotateCcw size={15} /> Re-analyze</button><button className="button primary" onClick={onEditor}>Open privacy editor <ArrowRight size={15} /></button></div></main></div>;
}

function FindingCard({ finding }: { finding: PrivacyFinding }): JSX.Element { const [open, setOpen] = useState(false); return <article className={`finding-card ${severityClass(finding.severity)}`}><button className="finding-summary" onClick={() => setOpen(!open)}><span className="finding-icon">{finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? <CircleAlert size={16} /> : <Zap size={16} />}</span><span className="finding-main"><b>{finding.category}</b><small>{finding.evidence}</small></span><span className="severity-badge">{finding.severity}</span><ChevronDown className={open ? 'rotated' : ''} size={17} /></button>{open && <div className="finding-detail"><p><strong>Why it matters</strong>{finding.explanation}</p><p><strong>Recommended</strong>{finding.recommendation}</p><span className="confidence">{finding.confidence}% confidence · from {finding.source}</span></div>}</article>; }

function EditorView({ result, text, onRecheck, onClosed, onCopy, onNavigate }: { result: AnalysisResult | null; text: string; onRecheck: (text: string) => void; onClosed: () => void; onCopy: (value: string) => void; onNavigate: (view: AppView) => void }): JSX.Element {
  const [draft, setDraft] = useState(result?.saferVersion || text);
  const [applied, setApplied] = useState(false);
  const score = result?.score ?? 0;
  const after = useMemo(() => analyzePrivacy([{ name: 'Safer draft', kind: 'text', text: draft }]), [draft]);
  return <div className="workspace"><SideRail view="editor" onNavigate={onNavigate} /><main className="workspace-main"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> PRIVACY EDITOR</div><h1>Edit & make it safer</h1><p>Change the wording, remove clues, then run the check again.</p></div><button className="button outline" onClick={onClosed}><Trash2 size={15} /> Discard</button></div><div className="editor-grid"><section className="panel editor-panel"><div className="panel-header"><div><span className="section-kicker">TEXT TOOLS</span><h2>Suggested safer version</h2></div><span className="editor-status"><span className="live-dot" /> In browser memory</span></div><div className="tool-row"><span><Scissors size={14} /> Remove clues</span><span><LockKeyhole size={14} /> Keep original safe</span></div><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setApplied(false); }} /><div className="editor-actions"><button className="button outline" onClick={() => setDraft(result?.saferVersion || text)}><RotateCcw size={14} /> Reset suggestion</button><button className="button outline" onClick={() => onCopy(draft)}><Copy size={14} /> Copy safer version</button><button className="button primary" onClick={() => { setApplied(true); onRecheck(draft); }}>Re-analyze <ArrowRight size={15} /></button></div>{applied && <div className="success-callout compact"><Check size={18} /><span>Safer version analyzed. The comparison is updated below.</span></div>}</section><section className="panel compare-panel"><div className="section-kicker">BEFORE VS AFTER</div><h2>Risk reduced by {Math.max(0, score - after.score)} points</h2><div className="compare-row"><div><span>Before</span><strong className={scoreColor(score)}>{score}</strong><small>{result?.classification ?? 'Not checked'}</small></div><ArrowRight size={18} /><div><span>After</span><strong className={scoreColor(after.score)}>{after.score}</strong><small>{after.classification}</small></div></div><div className="bar-track"><span style={{ width: `${Math.max(4, score)}%` }} /><i style={{ width: `${Math.max(4, after.score)}%` }} /></div><div className="legend"><span><i className="before-dot" /> Original</span><span><i className="after-dot" /> Safer version</span></div></section></div><section className="panel visual-tools"><div className="panel-header"><div><span className="section-kicker">MEDIA TOOLS</span><h2>For image and video content</h2></div><span className="muted-text">Preview tools are ready for review</span></div><div className="tool-cards"><div><FileImage size={20} /><b>Blur / cover</b><p>Mark a face, sign, or identifier for review before export.</p><button className="button small outline" onClick={() => onCopy('Image redaction recommended: review visible signs, faces, and IDs before sharing.')}>Create redaction note</button></div><div><Film size={20} /><b>Review timestamps</b><p>Video frames should be checked at representative moments, not every frame.</p><button className="button small outline" onClick={() => onCopy('Video review note created. Check representative frames and audio before sharing.')}>Create review note</button></div><div><AudioLines size={20} /><b>Audio awareness</b><p>Audio can reveal names, phone numbers, places, and plans even when visuals look safe.</p><button className="button small outline" onClick={() => onCopy('Audio review note created. Listen for direct identifiers and exact plans.')}>Create review note</button></div></div></section></main></div>;
}

function ClosedView({ onStart, onHome }: { onStart: () => void; onHome: () => void }): JSX.Element { return <main className="closed-page"><div className="closed-glow" /><span className="brand-mark large"><Shield size={34} /></span><div className="eyebrow"><span className="eyebrow-dot" /> SESSION CLOSED</div><h1>Your private session is clear.</h1><p>Temporary application session data was cleared from this browser session. You decide what to share and when.</p><div className="closed-actions"><button className="button primary large" onClick={onStart}>Start new session <ArrowRight size={17} /></button><button className="button ghost large" onClick={onHome}>Back to home</button></div></main>; }

export default function PrivacyApp(): JSX.Element {
  const [view, setView] = useState<AppView>('home');
  const [session, setSession] = useState<Session | null>(null);
  const [queue, setQueue] = useState<QueueFile[]>([]);
  const [text, setText] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedInput[]>([]);
  const [history, setHistory] = useState<ScoreHistoryItem[]>([]);
  const [social, setSocial] = useState<SocialPost>({ caption: '', hashtags: '', location: '', altText: '' });
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const { user, loading: authLoading } = useAuth();
  const queueRef = useRef<QueueFile[]>([]);

  useEffect(() => { const path = window.location.pathname; if (path === '/analyze') setView('analyze'); else if (path === '/result') setView('results'); else if (path === '/editor') setView('editor'); else if (path === '/session-closed') setView('closed'); else if (path === '/studio') setView('studio'); const stored = sessionStorage.getItem('pbyp-session'); if (stored) setSession(JSON.parse(stored) as Session); }, []);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 2600); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { if (!session) return; const remaining = session.expiresAt - Date.now(); if (remaining <= 0) { endSession(); return; } const timer = window.setTimeout(() => endSession(), remaining); return () => window.clearTimeout(timer); }, [session]);

  const navigate = (next: AppView) => { const path = next === 'home' ? '/' : next === 'results' ? '/result' : next === 'closed' ? '/session-closed' : `/${next}`; window.history.pushState({}, '', path); setView(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const showSection = (id: string) => { if (view !== 'home') navigate('home'); window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 80); };
  const startSession = () => { const next = createSession(); sessionStorage.setItem('pbyp-session', JSON.stringify(next)); setSession(next); setQueue([]); setText(''); setSocial({ caption: '', hashtags: '', location: '', altText: '' }); setResult(null); setSubmitted([]); setHistory([]); navigate('analyze'); };
  const endSession = () => { queueRef.current.forEach((item) => { if (item.preview) URL.revokeObjectURL(item.preview); }); sessionStorage.removeItem('pbyp-session'); setSession(null); setQueue([]); setText(''); setSocial({ caption: '', hashtags: '', location: '', altText: '' }); setResult(null); setSubmitted([]); setHistory([]); setAnalysisStatus(null); navigate('closed'); };
  const signOut = async () => { endSession(); const { error } = await supabase.auth.signOut(); if (error) setNotice('Could not sign out. Please try again.'); };
  const readPdf = async (id: string, file: File) => {
    try {
      const extraction = await extractPdfText(file);
      setQueue((current) => current.map((item) => (item.id === id ? { ...item, pdf: { status: 'ready', extraction } } : item)));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This PDF could not be read.';
      setQueue((current) => current.map((item) => (item.id === id ? { ...item, pdf: { status: 'error', message } } : item)));
    }
  };
  const addFiles = (files: File[]) => { const accepted = files.filter((file) => file.size <= 100 * 1024 * 1024 && kindForFile(file) !== 'file'); const next: QueueFile[] = accepted.map((file) => { const idBytes = new Uint8Array(4); crypto.getRandomValues(idBytes); const kind = kindForFile(file); return { id: `${file.name}-${Array.from(idBytes).join('')}`, file, kind, status: 'Ready', pdf: kind === 'pdf' ? { status: 'reading' } : undefined, preview: ['image', 'video', 'audio'].includes(kind) ? URL.createObjectURL(file) : undefined }; }); setQueue((current) => [...current, ...next]); next.forEach((item) => { if (item.kind === 'pdf') void readPdf(item.id, item.file); }); if (accepted.length !== files.length) setNotice('Some files were skipped because they are unsupported or exceed the 100 MB limit.'); };
  const removeFile = (id: string) => setQueue((current) => { const target = current.find((item) => item.id === id); if (target?.preview) URL.revokeObjectURL(target.preview); return current.filter((item) => item.id !== id); });
  const analyze = async (demoText?: string) => { const chosenText = demoText ?? text; const socialText = Object.values(social).filter(Boolean).join('\n'); const submittedInputs: SubmittedInput[] = [{ label: 'Text / note', text: chosenText.trim() }, { label: 'Caption', text: social.caption.trim() }, { label: 'Hashtags', text: social.hashtags.trim() }, { label: 'Location', text: social.location.trim() }, { label: 'Alt text', text: social.altText.trim() }].filter((input) => input.text.length > 0); setAnalysisStatus('Preparing content'); setAnalysisProgress(20); const fileSources: AnalysisSource[] = await Promise.all(queue.map(async (item) => { if (item.kind === 'pdf') return pdfSource(item); const source: AnalysisSource = { name: item.file.name, kind: item.kind }; if (item.kind === 'document' && item.file.size < 2 * 1024 * 1024) source.text = await item.file.text(); return source; })); setAnalysisStatus('Applying local privacy rules'); setAnalysisProgress(65); await new Promise<void>((resolve) => window.setTimeout(resolve, 120)); const next = analyzePrivacy([...fileSources, ...(chosenText.trim() ? [{ name: 'Text / note', kind: 'text', text: chosenText }] : []), ...(socialText ? [{ name: 'Social post fields', kind: 'social', text: socialText }] : [])]); setAnalysisStatus('Scoring findings'); setAnalysisProgress(90); await new Promise<void>((resolve) => window.setTimeout(resolve, 120)); setResult(next); setSubmitted(submittedInputs); setHistory((current) => [...current, { version: current.length + 1, score: next.score, classification: next.classification, createdAt: next.analyzedAt }]); if (demoText !== undefined) setText(demoText); setAnalysisProgress(100); setAnalysisStatus(null); navigate('results'); };
  const loadDemo = (demo: Demo) => { if (!session) startSession(); setText(demo.text); if (view === 'home') navigate('analyze'); setNotice(`${demo.name} loaded`); };

  if (authLoading) return <div className="auth-loading" aria-busy="true"><span className="brand-mark large"><Shield size={34} /></span></div>;
  if (!user) return <AuthGate />;
  return <div className="app-shell"><Header session={session} user={user} onStart={startSession} onEnd={endSession} onNavigate={navigate} onSection={showSection} onSignOut={() => { void signOut(); }} />{view === 'home' && <Home onStart={startSession} onDemo={loadDemo} onSection={showSection} />}{view === 'analyze' && <AnalyzeView queue={queue} onFiles={addFiles} onRemove={removeFile} text={text} setText={setText} social={social} setSocial={setSocial} onAnalyze={() => { void analyze(); }} onDemo={loadDemo} analysisStatus={analysisStatus} analysisProgress={analysisProgress} onNavigate={navigate} />}{view === 'results' && <ResultsView result={result} history={history} submitted={submitted} onEditor={() => navigate('editor')} onRecheck={() => { void analyze(); }} onNewAnalysis={() => navigate('analyze')} onNavigate={navigate} />}{view === 'editor' && <EditorView result={result} text={text} onRecheck={(draft) => { setText(draft); void analyze(draft); }} onClosed={endSession} onCopy={(value) => { void navigator.clipboard?.writeText(value); setNotice('Copied to clipboard'); }} onNavigate={navigate} />}{view === 'studio' && <div className="workspace"><SideRail view="studio" onNavigate={navigate} /><VideoStudio /></div>}{view === 'closed' && <ClosedView onStart={startSession} onHome={() => navigate('home')} />}{notice && <div className="toast"><Check size={16} /> {notice}</div>}</div>;
}
