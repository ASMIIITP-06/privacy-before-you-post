export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Classification = 'SAFE' | 'REVIEW' | 'HIGH RISK' | 'DO NOT POST';

export interface PdfPage {
  page: number;
  text: string;
}

export interface AnalysisSource {
  name: string;
  kind: string;
  text?: string;
  pages?: PdfPage[];
  readError?: string;
}

export interface UnreadableSource {
  name: string;
  reason: string;
}

export interface PrivacyFinding {
  id: string;
  category: string;
  severity: Severity;
  confidence: number;
  evidence: string;
  source: string;
  page?: number;
  explanation: string;
  recommendation: string;
  weight: number;
}

export interface AnalysisResult {
  id: string;
  score: number;
  classification: Classification;
  findings: PrivacyFinding[];
  inferences: string[];
  recommendations: string[];
  saferVersion: string;
  sources: AnalysisSource[];
  unreadable: UnreadableSource[];
  analyzedAt: number;
}

interface Rule {
  id: string;
  category: string;
  severity: Severity;
  confidence: number;
  explanation: string;
  recommendation: string;
  weight: number;
}

interface AnalysisUnit {
  file: string;
  page?: number;
  text: string;
}

interface Hit {
  rule: Rule;
  evidence: string;
}

interface RuleRecord {
  rule: Rule;
  file: string;
  evidence: string;
  pages: number[];
}

const masks: Array<[RegExp, string]> = [
  [/([\w.+-]+)@([\w-]+\.[\w.-]+)/gi, '$1•••@$2'],
  [/\b(?:\+?\d[\d ()-]{8,}\d)\b/g, '••• ••• ••'],
  [/\b(?:ID|student|employee)[\s:#-]*[A-Z0-9-]{5,}\b/gi, '••••••••'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '•••-••-••••'],
];

function maskEvidence(value: string): string {
  return masks.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), value).slice(0, 140);
}

function includesAny(text: string, terms: string[]): string | undefined {
  const lower = text.toLowerCase();
  return terms.find((term) => lower.includes(term));
}

const RULES: Record<string, Rule> = {
  email: { id: 'email', category: 'Personal information', severity: 'HIGH', confidence: 98, weight: 20, explanation: 'An email address can connect this post to an inbox, account, or organization.', recommendation: 'Remove the address or replace it with a generic contact method.' },
  phone: { id: 'phone', category: 'Personal information', severity: 'HIGH', confidence: 94, weight: 25, explanation: 'A phone number is a direct contact detail that can be reused outside this post.', recommendation: 'Remove or mask the number before sharing.' },
  name: { id: 'name', category: 'Personal information', severity: 'HIGH', confidence: 85, weight: 25, explanation: 'A full name next to a role label identifies a specific person.', recommendation: 'Replace the name with initials or a generic label.' },
  identifier: { id: 'identifier', category: 'Sensitive information', severity: 'CRITICAL', confidence: 91, weight: 40, explanation: 'An identifier can make a person or account easier to target or impersonate.', recommendation: 'Redact the identifier completely; do not rely on a partial blur.' },
  governmentId: { id: 'governmentId', category: 'Sensitive information', severity: 'CRITICAL', confidence: 93, weight: 45, explanation: 'Government identification numbers can be used for identity theft and fraud.', recommendation: 'Remove the number entirely and never share identity documents publicly.' },
  secret: { id: 'secret', category: 'Sensitive information', severity: 'CRITICAL', confidence: 96, weight: 50, explanation: 'Secrets can provide direct access to systems or accounts.', recommendation: 'Remove the secret and rotate it if it has already been shared.' },
  location: { id: 'location', category: 'Location', severity: 'HIGH', confidence: 88, weight: 30, explanation: 'A named place or recognizable setting may reveal where the content was created.', recommendation: 'Generalize the location and crop or blur identifying signs.' },
  address: { id: 'address', category: 'Location', severity: 'HIGH', confidence: 90, weight: 30, explanation: 'A street address can pinpoint where someone lives, studies, or works.', recommendation: 'Remove the street address and keep only a general area if needed.' },
  routine: { id: 'routine', category: 'Routine', severity: 'MEDIUM', confidence: 86, weight: 20, explanation: 'Precise timing can reveal when someone is likely to be at a place.', recommendation: 'Remove exact times or post after the activity is over.' },
  plan: { id: 'plan', category: 'Context', severity: 'MEDIUM', confidence: 82, weight: 25, explanation: 'Future plans can expose movement, availability, or a predictable schedule.', recommendation: 'Share after the event and remove precise plans.' },
  handle: { id: 'handle', category: 'Digital footprint', severity: 'LOW', confidence: 90, weight: 10, explanation: 'Handles and hashtags can connect this post with other public accounts and affiliations.', recommendation: 'Remove unnecessary handles or use a less identifying caption.' },
  metadata: { id: 'metadata', category: 'Metadata', severity: 'LOW', confidence: 68, weight: 10, explanation: 'Files can carry timestamps, device details, or location metadata that is not visible in the preview.', recommendation: 'Review metadata and export a sanitized copy before publishing.' },
  identity: { id: 'identity', category: 'Identity', severity: 'HIGH', confidence: 84, weight: 20, explanation: 'Small clues become more identifying when a place, time, affiliation, and person appear together.', recommendation: 'Remove at least one connecting clue from the set before posting.' },
};

const PATTERNS = {
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/i,
  phone: /\+?\d[\d ()-]{8,}\d/,
  name: /\b(?:name|full name|student|employee|patient|candidate|applicant)\s*:\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})\b/,
  identifier: /\b(?:student|employee|account|member|roll)\s*(?:id|number|no\.?)?\s*[:#-]?\s*[A-Z0-9-]{5,}\b/i,
  governmentId: /\b\d{3}-\d{2}-\d{4}\b|\b\d{4}\s\d{4}\s\d{4}\b|\b(?:passport|aadhaar|aadhar|national id|driver'?s? licen[cs]e)\s*(?:no\.?|number|#)?\s*[:#-]?\s*[A-Z0-9]{6,}\b/i,
  address: /\b\d{1,5}\s+(?:[A-Z][\w'-]*\s+){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Boulevard|Blvd|Drive|Dr|Way|Court|Ct)\b\.?/,
  timing: /\b(?:at|around|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i,
  recurring: /\b(?:every|each)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  plan: /(?:tomorrow|next week|leaving for|traveling to|flight|exam|meeting)/i,
  handle: /(?:#\w+|@\w+)/,
};

const SECRET_TERMS = ['password', 'api key', 'secret', 'token', 'private key', 'credential'];
const LOCATION_TERMS = ['institute', 'university', 'campus', 'cyber lab', 'hostel', 'street', 'road', 'building', 'room', 'airport', 'cafe', 'office'];

function detectUnit(text: string): Hit[] {
  const hits: Hit[] = [];
  const match = (rule: Rule, pattern: RegExp) => {
    const found = text.match(pattern);
    if (found) hits.push({ rule, evidence: found[0] });
  };
  match(RULES.email, PATTERNS.email);
  match(RULES.phone, PATTERNS.phone);
  match(RULES.name, PATTERNS.name);
  match(RULES.identifier, PATTERNS.identifier);
  match(RULES.governmentId, PATTERNS.governmentId);
  match(RULES.address, PATTERNS.address);
  const secret = includesAny(text, SECRET_TERMS);
  if (secret) hits.push({ rule: RULES.secret, evidence: 'Credential-like language detected' });
  const location = includesAny(text, LOCATION_TERMS);
  if (location) hits.push({ rule: RULES.location, evidence: location });
  const timing = text.match(PATTERNS.timing);
  if (timing || PATTERNS.recurring.test(text)) hits.push({ rule: RULES.routine, evidence: timing?.[0] ?? 'Recurring timing detected' });
  const plan = text.match(PATTERNS.plan);
  if (plan) hits.push({ rule: RULES.plan, evidence: 'Future plan or event timing detected' });
  const handle = text.match(PATTERNS.handle);
  if (handle) hits.push({ rule: RULES.handle, evidence: handle[0] });
  return hits;
}

function unitsFor(source: AnalysisSource): AnalysisUnit[] {
  if (source.readError) return [];
  if (source.pages) {
    return source.pages.filter((page) => page.text.trim().length > 0).map((page) => ({ file: source.name, page: page.page, text: page.text }));
  }
  if (source.kind === 'pdf') return [];
  return [{ file: source.name, text: source.text ?? source.name }];
}

function pageLabel(file: string, pages: number[]): string {
  if (pages.length === 0) return file;
  return `${file}, ${pages.length > 1 ? 'pages' : 'page'} ${pages.join(', ')}`;
}

function saferText(text: string): string {
  return text
    .replace(/\b(?:at|in|near)\s+[A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3}/g, ' at a private location')
    .replace(/\b(?:tomorrow|tonight|today)\b/gi, 'soon')
    .replace(/\b(?:at|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' later')
    .replace(/#[\w-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function analyzePrivacy(sources: AnalysisSource[]): AnalysisResult {
  const units = sources.flatMap(unitsFor);
  const sourceLabel = sources.length > 1 ? `${sources.length} items together` : sources[0]?.name ?? 'text input';
  const records = new Map<string, RuleRecord>();

  for (const unit of units) {
    for (const hit of detectUnit(unit.text)) {
      const key = `${hit.rule.id}|${unit.file}`;
      const record = records.get(key) ?? { rule: hit.rule, file: unit.file, evidence: hit.evidence, pages: [] };
      if (unit.page !== undefined && !record.pages.includes(unit.page)) record.pages.push(unit.page);
      records.set(key, record);
    }
  }

  const findings: PrivacyFinding[] = [];
  const pushFinding = (rule: Rule, evidence: string, source: string, page?: number) => {
    findings.push({
      id: `${rule.category}-${findings.length + 1}`,
      category: rule.category,
      severity: rule.severity,
      confidence: rule.confidence,
      evidence: maskEvidence(evidence),
      source,
      page,
      explanation: rule.explanation,
      recommendation: rule.recommendation,
      weight: rule.weight,
    });
  };

  for (const record of Array.from(records.values())) {
    const pages = [...record.pages].sort((a, b) => a - b);
    pushFinding(record.rule, record.evidence, pageLabel(record.file, pages), pages[0]);
  }

  for (const source of sources) {
    if (['image', 'video', 'document'].includes(source.kind) && !source.readError) {
      pushFinding(RULES.metadata, 'File metadata may be present', source.name);
    }
  }
  if (sources.length > 1 && findings.length > 1) {
    pushFinding(RULES.identity, 'Multiple clues can combine across files', sourceLabel);
  }

  const score = Math.min(100, findings.reduce((total, finding) => total + finding.weight, 0));
  const unreadable: UnreadableSource[] = sources
    .filter((source) => source.readError)
    .map((source) => ({ name: source.name, reason: source.readError ?? '' }));
  const baseClassification: Classification = score <= 20 ? 'SAFE' : score <= 50 ? 'REVIEW' : score <= 75 ? 'HIGH RISK' : 'DO NOT POST';
  const classification: Classification = unreadable.length > 0 && baseClassification === 'SAFE' ? 'REVIEW' : baseClassification;
  const inferences = findings.length === 0
    ? ['No obvious personal or contextual clues were detected by the local checker.']
    : [
        ...(findings.some((finding) => finding.category === 'Location') ? ['You may be associated with a recognizable place or institution.'] : []),
        ...(findings.some((finding) => finding.category === 'Routine') ? ['Someone may estimate when you are likely to be in a particular place.'] : []),
        ...(findings.some((finding) => finding.category === 'Identity') ? ['The combined clues may make the person or account easier to identify.'] : []),
        ...(findings.some((finding) => finding.category === 'Sensitive information') ? ['A viewer may gain information that could be used for targeting or impersonation.'] : []),
      ];
  const recommendations = Array.from(new Set(findings.map((finding) => finding.recommendation))).slice(0, 6);
  const fullText = units.map((unit) => unit.text).join('\n');

  return {
    id: `analysis-${Date.now()}`,
    score,
    classification,
    findings,
    inferences,
    recommendations,
    saferVersion: fullText ? saferText(fullText) : 'Review visible signs, metadata, and personal identifiers before sharing.',
    sources,
    unreadable,
    analyzedAt: Date.now(),
  };
}
