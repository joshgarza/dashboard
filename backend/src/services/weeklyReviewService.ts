import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import { getHopperDb } from './hopperDb.js';
import { initWeeklyReviewSchema } from './hopperSchema.js';
import { completeTodo } from './todoService.js';
import { runCodexStructuredTask, streamCodexTurn } from './codexProvider.js';
import { sessionManager } from './sessionManager.js';
import type {
  FinalizedWeeklyReview,
  WeeklyPlan,
  WeeklyReviewCompletionSummary,
  WeeklyReviewRecord,
  WeeklyReviewSummary,
  DailyPlan,
  DailyTask,
  ChatMessage,
  InterviewStatus,
  WeeklyContext,
  LearningProfile,
} from '../types/weeklyReview.js';

const PROFILE_PATH = path.resolve(import.meta.dirname, '../../data/learning-profile.yaml');

// ── Init ─────────────────────────────────────────────────────────────────────

initWeeklyReviewSchema();

// ── Date helpers ─────────────────────────────────────────────────────────────

function getNowInPT(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value);
  const day = parseInt(parts.find(p => p.type === 'day')!.value);
  return new Date(year, month - 1, day);
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getCurrentWeekString(): string {
  const now = getNowInPT();
  const week = getISOWeek(now);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getWeekStringForDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  const week = getISOWeek(date);
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getPreviousWeekString(): string {
  const now = getNowInPT();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const week = getISOWeek(weekAgo);
  return `${weekAgo.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function getTodayDateString(): string {
  const now = getNowInPT();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── DB read helpers ───────────────────────────────────────────────────────────

interface PlanRow {
  id: number;
  week: string;
  weekly_goals: string;
  interviewed_at: string;
}

interface TaskRow {
  id: number;
  plan_id: number;
  thought_id: number | null;
  scheduled_date: string;
  day_focus: string | null;
  task_text: string;
  sort_order: number;
  completed: number;
  completed_at: string | null;
}

interface DeferredRow {
  id: number;
  thought_id: number | null;
  task_text: string;
  status: string;
}

interface ReviewSnapshotRow {
  id: number;
  week: string;
  interviewed_at: string;
  plan_json: string;
}

interface ProfileStateRow {
  key: string;
  value_json: string;
  confidence: number;
  source_memory_id: number | null;
  updated_at: string;
}

interface MemoryItemRow {
  id: number;
  review_snapshot_id: number | null;
  kind: string;
  normalized_key: string | null;
  summary: string;
  detail_json: string;
  confidence: number;
  status: 'active' | 'superseded' | 'archived';
  supersedes_memory_id: number | null;
  created_at: string;
  updated_at: string;
}

interface MemoryVectorRow {
  memory_id: number;
  vector_json: string;
  search_text: string;
  concepts_json: string;
  updated_at: string;
}

interface ExtractedStateUpdate {
  key: string;
  value: string | number | boolean;
  confidence: number;
}

interface ExtractedMemoryEvidence {
  sourceType: string;
  sourceRef: string;
  excerpt: string;
  weight: number;
}

interface ExtractedMemoryCandidate {
  kind: 'energy_pattern' | 'completion_pattern' | 'workflow_pattern' | 'work_preference';
  normalizedKey: string | null;
  summary: string;
  detailSummary: string;
  confidence: number;
  evidence: ExtractedMemoryEvidence[];
}

interface ExtractedLearningUpdate {
  stateUpdates: ExtractedStateUpdate[];
  memoryCandidates: ExtractedMemoryCandidate[];
  weeklyOutcome: {
    notes: string | null;
  };
}

interface LegacyReviewHistoryEntry {
  week: string;
  planned: number;
  completed: number;
  notes: string;
}

interface RetrievalArtifacts {
  searchText: string;
  vector: Record<string, number>;
  concepts: string[];
}

interface RankedMemory {
  row: MemoryItemRow;
  score: number;
}

interface PlannedDayOutput {
  date: string;
  focus: string;
  tasks: Array<{
    text: string;
    thought_id: number | null;
    completed: boolean;
  }>;
}

const PROFILE_STATE_KEYS = {
  maxDailyTasks: 'work_preferences.max_daily_tasks',
  prefersDeepWorkMornings: 'work_preferences.prefers_deep_work_mornings',
  avgWeeklyCompletion: 'completion_patterns.avg_weekly_completion',
} as const;

const RECENT_OUTCOME_LIMIT = 2;
const RELEVANT_MEMORY_LIMIT = 6;
const MEMORY_SUMMARY_CHAR_BUDGET = 1200;
const MAX_ACTIVE_MEMORY_SUMMARY = 12;

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'because',
  'been',
  'before',
  'being',
  'between',
  'both',
  'does',
  'each',
  'feel',
  'from',
  'have',
  'into',
  'just',
  'more',
  'most',
  'much',
  'need',
  'only',
  'over',
  'same',
  'some',
  'than',
  'that',
  'them',
  'then',
  'they',
  'this',
  'those',
  'through',
  'very',
  'what',
  'when',
  'where',
  'which',
  'with',
  'work',
  'week',
  'weekly',
  'will',
  'your',
]);

const CONCEPT_KEYWORDS: Array<[string, string[]]> = [
  ['outreach', ['outreach', 'network', 'linkedin', 'follow-up', 'followup', 'crm', 'intro', 'message']],
  ['experiments', ['experiment', 'measurement', 'metric', 'test', 'ab', 'a/b', 'tracking']],
  ['systems', ['system', 'infrastructure', 'tooling', 'automation', 'setup']],
  ['admin', ['admin', 'permit', 'paperwork', 'message', 'email', 'appointment']],
  ['health', ['health', 'medical', 'dentist', 'doctor']],
  ['energy', ['energy', 'morning', 'afternoon', 'evening', 'tired', 'low-energy', 'deep work']],
  ['planning', ['plan', 'planning', 'review', 'weekly review', 'schedule', 'buffer']],
  ['move', ['move', 'moving', 'packing', 'apartment']],
];

function parseWeeklyPlan(rawPlan: string): WeeklyPlan {
  return JSON.parse(rawPlan) as WeeklyPlan;
}

function countPlanTasks(plan: WeeklyPlan): number {
  return Object.values(plan.days).reduce((count, day) => count + day.tasks.length, 0);
}

function flattenPlanTasks(plan: WeeklyPlan): DailyTask[] {
  return Object.values(plan.days).flatMap((day) => day.tasks);
}

function countCompletedTasks(plan: WeeklyPlan): number {
  return flattenPlanTasks(plan).filter((task) => task.completed).length;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function assertStrictStructuredOutputSchema(
  schema: unknown,
  context = 'root',
): void {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  const node = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: unknown;
    additionalProperties?: unknown;
    items?: unknown;
    anyOf?: unknown[];
  };

  if (node.type === 'object') {
    const propertyKeys = Object.keys(node.properties ?? {});
    const required = Array.isArray(node.required) ? node.required : null;
    if (!required) {
      throw new Error(`Structured output schema at ${context} must define required for all properties`);
    }

    const missingRequired = propertyKeys.filter((key) => !required.includes(key));
    const extraRequired = required.filter((key) => !propertyKeys.includes(String(key)));
    if (missingRequired.length > 0 || extraRequired.length > 0) {
      throw new Error(
        `Structured output schema at ${context} must require exactly its properties. Missing: ${missingRequired.join(', ') || '(none)'}. Extra: ${extraRequired.join(', ') || '(none)'}`,
      );
    }

    if (node.additionalProperties !== false) {
      throw new Error(`Structured output schema at ${context} must set additionalProperties to false`);
    }

    for (const [key, value] of Object.entries(node.properties ?? {})) {
      assertStrictStructuredOutputSchema(value, `${context}.${key}`);
    }
  }

  if (node.type === 'array' && node.items) {
    assertStrictStructuredOutputSchema(node.items, `${context}[]`);
  }

  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((entry, index) => {
      assertStrictStructuredOutputSchema(entry, `${context}.anyOf[${index}]`);
    });
  }
}

function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function slugify(text: string, maxLength = 48): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug.slice(0, maxLength) || 'memory';
}

function parseYamlScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, '\'');
  }

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

function parseLegacyLearningProfile(yaml: string): LearningProfile | null {
  if (!yaml.trim()) {
    return null;
  }

  const profile: LearningProfile = {
    energy_patterns: {
      notes: '',
    },
    work_preferences: {
      max_daily_tasks: 5,
      prefers_deep_work_mornings: false,
    },
    completion_patterns: {
      avg_weekly_completion: 0,
      commonly_deferred: [],
      commonly_completed_first: [],
    },
    review_history: [],
  };

  let section: 'energy_patterns' | 'work_preferences' | 'completion_patterns' | 'review_history' | null = null;
  let currentList: 'commonly_deferred' | 'commonly_completed_first' | null = null;
  let currentHistory: LegacyReviewHistoryEntry | null = null;

  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    if (/^[a-z_]+:\s*$/.test(line)) {
      if (currentHistory) {
        profile.review_history.push(currentHistory);
        currentHistory = null;
      }

      section = line.replace(':', '').trim() as Exclude<typeof section, null>;
      currentList = null;
      continue;
    }

    if (section === 'energy_patterns') {
      const notesMatch = /^  notes:\s*(.+)$/.exec(line);
      if (notesMatch) {
        profile.energy_patterns.notes = String(parseYamlScalar(notesMatch[1]));
      }
      continue;
    }

    if (section === 'work_preferences') {
      const maxTasksMatch = /^  max_daily_tasks:\s*(.+)$/.exec(line);
      if (maxTasksMatch) {
        profile.work_preferences.max_daily_tasks = Number(parseYamlScalar(maxTasksMatch[1]));
        continue;
      }

      const deepWorkMatch = /^  prefers_deep_work_mornings:\s*(.+)$/.exec(line);
      if (deepWorkMatch) {
        profile.work_preferences.prefers_deep_work_mornings = Boolean(parseYamlScalar(deepWorkMatch[1]));
      }
      continue;
    }

    if (section === 'completion_patterns') {
      const avgMatch = /^  avg_weekly_completion:\s*(.+)$/.exec(line);
      if (avgMatch) {
        profile.completion_patterns.avg_weekly_completion = Number(parseYamlScalar(avgMatch[1]));
        continue;
      }

      if (/^  commonly_deferred:\s*$/.test(line)) {
        currentList = 'commonly_deferred';
        continue;
      }

      if (/^  commonly_completed_first:\s*$/.test(line)) {
        currentList = 'commonly_completed_first';
        continue;
      }

      const itemMatch = /^    -\s*(.+)$/.exec(line);
      if (itemMatch && currentList) {
        profile.completion_patterns[currentList].push(String(parseYamlScalar(itemMatch[1])));
      }
      continue;
    }

    if (section === 'review_history') {
      const weekMatch = /^  - week:\s*(.+)$/.exec(line);
      if (weekMatch) {
        if (currentHistory) {
          profile.review_history.push(currentHistory);
        }

        currentHistory = {
          week: String(parseYamlScalar(weekMatch[1])),
          planned: 0,
          completed: 0,
          notes: '',
        };
        continue;
      }

      if (!currentHistory) {
        continue;
      }

      const plannedMatch = /^    planned:\s*(.+)$/.exec(line);
      if (plannedMatch) {
        currentHistory.planned = Number(parseYamlScalar(plannedMatch[1]));
        continue;
      }

      const completedMatch = /^    completed:\s*(.+)$/.exec(line);
      if (completedMatch) {
        currentHistory.completed = Number(parseYamlScalar(completedMatch[1]));
        continue;
      }

      const notesMatch = /^    notes:\s*(.+)$/.exec(line);
      if (notesMatch) {
        currentHistory.notes = String(parseYamlScalar(notesMatch[1]));
      }
    }
  }

  if (currentHistory) {
    profile.review_history.push(currentHistory);
  }

  return profile;
}

function getProfileStateRows(): ProfileStateRow[] {
  const db = getHopperDb();
  return db
    .prepare('SELECT * FROM svc_weekly_review_profile_state ORDER BY key ASC')
    .all() as ProfileStateRow[];
}

function getProfileStateValue<T extends string | number | boolean>(key: string): T | null {
  const db = getHopperDb();
  const row = db
    .prepare('SELECT * FROM svc_weekly_review_profile_state WHERE key = ?')
    .get(key) as ProfileStateRow | undefined;

  if (!row) {
    return null;
  }

  return safeJsonParse<T | null>(row.value_json, null);
}

function upsertProfileState(
  key: string,
  value: string | number | boolean,
  confidence: number,
  sourceMemoryId: number | null = null,
): void {
  const db = getHopperDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO svc_weekly_review_profile_state (key, value_json, confidence, source_memory_id, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      confidence = excluded.confidence,
      source_memory_id = excluded.source_memory_id,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), clamp(confidence), sourceMemoryId, now);
}

function normalizeMemoryKey(kind: string, normalizedKey: string | null, summary: string): string | null {
  const base = (normalizedKey ?? '').trim() || slugify(summary);
  if (!base) {
    return null;
  }

  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!sanitized) {
    return null;
  }

  return sanitized.startsWith(`${kind}.`) ? sanitized : `${kind}.${sanitized}`;
}

function stemToken(token: string): string {
  if (token.endsWith('ing') && token.length > 5) {
    return token.slice(0, -3);
  }

  if (token.endsWith('ed') && token.length > 4) {
    return token.slice(0, -2);
  }

  if (token.endsWith('s') && token.length > 4) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenizeForRetrieval(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => stemToken(token.trim()))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function extractConcepts(text: string): string[] {
  const lowered = text.toLowerCase();
  const concepts = new Set<string>();

  for (const [concept, keywords] of CONCEPT_KEYWORDS) {
    if (keywords.some((keyword) => lowered.includes(keyword))) {
      concepts.add(concept);
    }
  }

  return Array.from(concepts).sort();
}

function buildSearchVector(text: string): Record<string, number> {
  const counts = new Map<string, number>();

  for (const token of tokenizeForRetrieval(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const entries = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24);

  const magnitude = Math.sqrt(entries.reduce((sum, [, count]) => sum + (count ** 2), 0)) || 1;
  const vector: Record<string, number> = {};

  for (const [token, count] of entries) {
    vector[token] = roundTo(count / magnitude, 4);
  }

  return vector;
}

function buildRetrievalArtifacts(summary: string, detail: Record<string, unknown>): RetrievalArtifacts {
  const searchText = `${summary}\n${JSON.stringify(detail)}`;
  return {
    searchText,
    vector: buildSearchVector(searchText),
    concepts: extractConcepts(searchText),
  };
}

function dotProduct(left: Record<string, number>, right: Record<string, number>): number {
  const [smaller, larger] =
    Object.keys(left).length <= Object.keys(right).length ? [left, right] : [right, left];

  let total = 0;
  for (const [token, value] of Object.entries(smaller)) {
    total += value * (larger[token] ?? 0);
  }

  return total;
}

function getRecencyScore(isoTimestamp: string): number {
  const ageMs = Date.now() - new Date(isoTimestamp).getTime();
  const ageDays = Number.isFinite(ageMs) ? ageMs / (1000 * 60 * 60 * 24) : 365;
  return clamp(1 - (ageDays / 180), 0.1, 1);
}

function parseMemoryDetail(row: MemoryItemRow): Record<string, unknown> {
  return safeJsonParse<Record<string, unknown>>(row.detail_json, {});
}

function loadActiveMemoryRows(kind?: string): MemoryItemRow[] {
  const db = getHopperDb();
  if (kind) {
    return db
      .prepare(`
        SELECT *
        FROM svc_weekly_review_memory_items
        WHERE status = 'active' AND kind = ?
        ORDER BY updated_at DESC, id DESC
      `)
      .all(kind) as MemoryItemRow[];
  }

  return db
    .prepare(`
      SELECT *
      FROM svc_weekly_review_memory_items
      WHERE status = 'active'
      ORDER BY updated_at DESC, id DESC
    `)
    .all() as MemoryItemRow[];
}

function upsertMemoryVector(memoryId: number, summary: string, detail: Record<string, unknown>): void {
  const db = getHopperDb();
  const artifacts = buildRetrievalArtifacts(summary, detail);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO svc_weekly_review_memory_vectors (memory_id, vector_json, search_text, concepts_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      vector_json = excluded.vector_json,
      search_text = excluded.search_text,
      concepts_json = excluded.concepts_json,
      updated_at = excluded.updated_at
  `).run(
    memoryId,
    JSON.stringify(artifacts.vector),
    artifacts.searchText,
    JSON.stringify(artifacts.concepts),
    now,
  );
}

function upsertMemoryItem(options: {
  reviewSnapshotId: number | null;
  kind: string;
  normalizedKey: string | null;
  summary: string;
  detail: Record<string, unknown>;
  confidence: number;
  evidence: ExtractedMemoryEvidence[];
}): number {
  const db = getHopperDb();
  const now = new Date().toISOString();
  const normalizedKey = normalizeMemoryKey(options.kind, options.normalizedKey, options.summary);
  const detailJson = JSON.stringify(options.detail);

  const existing = normalizedKey
    ? db
      .prepare(`
        SELECT *
        FROM svc_weekly_review_memory_items
        WHERE normalized_key = ? AND status = 'active'
        LIMIT 1
      `)
      .get(normalizedKey) as MemoryItemRow | undefined
    : undefined;

  let memoryId: number;
  if (
    existing &&
    existing.summary === options.summary &&
    existing.detail_json === detailJson
  ) {
    db.prepare(`
      UPDATE svc_weekly_review_memory_items
      SET review_snapshot_id = ?, confidence = ?, updated_at = ?
      WHERE id = ?
    `).run(options.reviewSnapshotId, clamp(options.confidence), now, existing.id);
    memoryId = existing.id;
    db.prepare('DELETE FROM svc_weekly_review_memory_evidence WHERE memory_id = ?').run(memoryId);
  } else {
    if (existing) {
      db.prepare(`
        UPDATE svc_weekly_review_memory_items
        SET status = 'superseded', updated_at = ?
        WHERE id = ?
      `).run(now, existing.id);
    }

    const result = db.prepare(`
      INSERT INTO svc_weekly_review_memory_items
        (review_snapshot_id, kind, normalized_key, summary, detail_json, confidence, status, supersedes_memory_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      options.reviewSnapshotId,
      options.kind,
      normalizedKey,
      options.summary,
      detailJson,
      clamp(options.confidence),
      existing?.id ?? null,
      now,
      now,
    );
    memoryId = Number(result.lastInsertRowid);
  }

  for (const evidence of options.evidence.slice(0, 3)) {
    db.prepare(`
      INSERT INTO svc_weekly_review_memory_evidence (memory_id, source_type, source_ref, excerpt, weight, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      memoryId,
      evidence.sourceType,
      evidence.sourceRef,
      evidence.excerpt,
      clamp(evidence.weight),
      now,
    );
  }

  upsertMemoryVector(memoryId, options.summary, options.detail);

  return memoryId;
}

function migrateLegacyProfileToDb(): void {
  const db = getHopperDb();
  const stateCount = (db.prepare('SELECT COUNT(*) AS count FROM svc_weekly_review_profile_state').get() as { count: number }).count;
  const memoryCount = (db.prepare('SELECT COUNT(*) AS count FROM svc_weekly_review_memory_items').get() as { count: number }).count;

  if (stateCount > 0 || memoryCount > 0 || !fs.existsSync(PROFILE_PATH)) {
    return;
  }

  const rawProfile = fs.readFileSync(PROFILE_PATH, 'utf-8');
  const profile = parseLegacyLearningProfile(rawProfile);
  if (!profile) {
    return;
  }

  const migrate = db.transaction(() => {
    upsertProfileState(PROFILE_STATE_KEYS.maxDailyTasks, profile.work_preferences.max_daily_tasks, 0.8);
    upsertProfileState(PROFILE_STATE_KEYS.prefersDeepWorkMornings, profile.work_preferences.prefers_deep_work_mornings, 0.8);
    upsertProfileState(PROFILE_STATE_KEYS.avgWeeklyCompletion, roundTo(profile.completion_patterns.avg_weekly_completion, 2), 0.7);

    if (profile.energy_patterns.notes.trim()) {
      upsertMemoryItem({
        reviewSnapshotId: null,
        kind: 'energy_pattern',
        normalizedKey: 'energy_pattern.core_notes',
        summary: profile.energy_patterns.notes.trim(),
        detail: { importedFrom: 'legacy_yaml' },
        confidence: 0.7,
        evidence: [
          {
            sourceType: 'legacy_profile',
            sourceRef: 'energy_patterns.notes',
            excerpt: profile.energy_patterns.notes.trim(),
            weight: 0.7,
          },
        ],
      });
    }

    for (const entry of profile.completion_patterns.commonly_deferred) {
      upsertMemoryItem({
        reviewSnapshotId: null,
        kind: 'completion_pattern',
        normalizedKey: `completion_pattern.defer_${slugify(entry, 32)}`,
        summary: entry,
        detail: { bucket: 'commonly_deferred', importedFrom: 'legacy_yaml' },
        confidence: 0.7,
        evidence: [
          {
            sourceType: 'legacy_profile',
            sourceRef: 'completion_patterns.commonly_deferred',
            excerpt: entry,
            weight: 0.7,
          },
        ],
      });
    }

    for (const entry of profile.completion_patterns.commonly_completed_first) {
      upsertMemoryItem({
        reviewSnapshotId: null,
        kind: 'completion_pattern',
        normalizedKey: `completion_pattern.complete_first_${slugify(entry, 32)}`,
        summary: entry,
        detail: { bucket: 'commonly_completed_first', importedFrom: 'legacy_yaml' },
        confidence: 0.7,
        evidence: [
          {
            sourceType: 'legacy_profile',
            sourceRef: 'completion_patterns.commonly_completed_first',
            excerpt: entry,
            weight: 0.7,
          },
        ],
      });
    }

    for (const entry of profile.review_history) {
      upsertMemoryItem({
        reviewSnapshotId: null,
        kind: 'weekly_outcome',
        normalizedKey: `weekly_outcome.${entry.week}.legacy`,
        summary: `${entry.week}: ${entry.completed}/${entry.planned} completed. ${entry.notes}`,
        detail: {
          week: entry.week,
          planned: entry.planned,
          completed: entry.completed,
          notes: entry.notes,
          importedFrom: 'legacy_yaml',
        },
        confidence: 0.7,
        evidence: [
          {
            sourceType: 'legacy_profile',
            sourceRef: `review_history.${entry.week}`,
            excerpt: entry.notes,
            weight: 0.7,
          },
        ],
      });
    }
  });

  migrate();
}

function buildProfileStateSummary(): string {
  const rows = getProfileStateRows();
  if (rows.length === 0) {
    return 'No explicit planning preferences stored yet.';
  }

  const lines: string[] = [];
  const maxDailyTasks = getProfileStateValue<number>(PROFILE_STATE_KEYS.maxDailyTasks);
  if (maxDailyTasks != null) {
    lines.push(`- Max daily tasks target: ${maxDailyTasks}`);
  }

  const prefersDeepWorkMornings = getProfileStateValue<boolean>(PROFILE_STATE_KEYS.prefersDeepWorkMornings);
  if (prefersDeepWorkMornings != null) {
    lines.push(`- Prefers deep work mornings: ${prefersDeepWorkMornings ? 'yes' : 'no'}`);
  }

  const avgWeeklyCompletion = getProfileStateValue<number>(PROFILE_STATE_KEYS.avgWeeklyCompletion);
  if (avgWeeklyCompletion != null) {
    lines.push(`- Rolling weekly completion rate: ${Math.round(avgWeeklyCompletion * 100)}%`);
  }

  return lines.length > 0 ? lines.join('\n') : 'No explicit planning preferences stored yet.';
}

function formatRelevantMemorySummary(rows: MemoryItemRow[]): string {
  if (rows.length === 0) {
    return 'No durable planning patterns stored yet.';
  }

  const lines: string[] = [];
  let usedChars = 0;

  for (const row of rows) {
    const label =
      row.kind === 'energy_pattern' ? 'Energy' :
      row.kind === 'completion_pattern' ? 'Completion' :
      row.kind === 'workflow_pattern' ? 'Workflow' :
      row.kind === 'work_preference' ? 'Preference' :
      'Memory';
    const line = `- ${label}: ${row.summary}`;
    if (usedChars + line.length > MEMORY_SUMMARY_CHAR_BUDGET) {
      break;
    }
    lines.push(line);
    usedChars += line.length;
  }

  return lines.join('\n');
}

function rankRelevantMemories(queryText: string): MemoryItemRow[] {
  const db = getHopperDb();
  const memories = loadActiveMemoryRows().filter((row) => row.kind !== 'weekly_outcome');
  if (memories.length === 0) {
    return [];
  }

  const vectorRows = db
    .prepare(`
      SELECT *
      FROM svc_weekly_review_memory_vectors
      WHERE memory_id IN (
        SELECT id FROM svc_weekly_review_memory_items
        WHERE status = 'active' AND kind != 'weekly_outcome'
      )
    `)
    .all() as MemoryVectorRow[];
  const vectorsById = new Map(vectorRows.map((row) => [row.memory_id, row]));
  const queryArtifacts = buildRetrievalArtifacts(queryText, {});
  const queryConcepts = new Set(queryArtifacts.concepts);

  const ranked = memories.map((row): RankedMemory => {
    const vectorRow = vectorsById.get(row.id);
    const storedVector = vectorRow ? safeJsonParse<Record<string, number>>(vectorRow.vector_json, {}) : {};
    const storedConcepts = new Set(
      vectorRow ? safeJsonParse<string[]>(vectorRow.concepts_json, []) : [],
    );
    const semanticScore = dotProduct(queryArtifacts.vector, storedVector);
    const sharedConcepts = Array.from(queryConcepts).filter((concept) => storedConcepts.has(concept)).length;
    const conceptScore =
      queryConcepts.size > 0 ? sharedConcepts / queryConcepts.size : (storedConcepts.size > 0 ? 0.2 : 0);
    const score =
      (semanticScore * 0.55) +
      (conceptScore * 0.2) +
      (clamp(row.confidence) * 0.15) +
      (getRecencyScore(row.updated_at) * 0.1);

    return { row, score };
  });

  ranked.sort((left, right) => right.score - left.score);
  const selected = ranked
    .filter((entry) => entry.score >= 0.18)
    .slice(0, RELEVANT_MEMORY_LIMIT)
    .map((entry) => entry.row);

  if (selected.length > 0) {
    return selected;
  }

  return ranked.slice(0, Math.min(RELEVANT_MEMORY_LIMIT, ranked.length)).map((entry) => entry.row);
}

function buildRelevantMemorySummary(queryText: string): string {
  return formatRelevantMemorySummary(rankRelevantMemories(queryText));
}

function buildRecentOutcomeSummary(): string {
  const outcomeRows = loadActiveMemoryRows('weekly_outcome').slice(0, RECENT_OUTCOME_LIMIT);
  if (outcomeRows.length > 0) {
    return outcomeRows
      .map((row) => {
        const detail = parseMemoryDetail(row);
        const week = typeof detail.week === 'string' ? detail.week : row.summary.split(':', 1)[0];
        const planned = typeof detail.planned === 'number' ? detail.planned : null;
        const completed = typeof detail.completed === 'number' ? detail.completed : null;
        const notes = typeof detail.notes === 'string' ? detail.notes : row.summary;
        if (planned != null && completed != null) {
          return `- ${week}: ${completed}/${planned} completed at review time. ${notes}`;
        }
        return `- ${week}: ${notes}`;
      })
      .join('\n');
  }

  const db = getHopperDb();
  const snapshotRows = db
    .prepare(`
      SELECT *
      FROM svc_weekly_review_review_snapshots
      ORDER BY interviewed_at DESC, id DESC
      LIMIT ?
    `)
    .all(RECENT_OUTCOME_LIMIT) as ReviewSnapshotRow[];

  if (snapshotRows.length === 0) {
    return 'No recent review outcomes stored yet.';
  }

  return snapshotRows.map((row) => {
    const plan = parseWeeklyPlan(row.plan_json);
    const assignedCount = countPlanTasks(plan);
    const completedCount = buildCompletionSummary(plan)?.completedCount ?? countCompletedTasks(plan);
    return `- ${plan.week}: ${completedCount}/${assignedCount} completed at review time. Goals: ${plan.weeklyGoals.join('; ') || 'none'}`;
  }).join('\n');
}

function buildActiveMemorySummary(limit = MAX_ACTIVE_MEMORY_SUMMARY): string {
  const rows = loadActiveMemoryRows()
    .filter((row) => row.kind !== 'weekly_outcome')
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      return right.updated_at.localeCompare(left.updated_at);
    })
    .slice(0, limit);

  if (rows.length === 0) {
    return 'No active memory records yet.';
  }

  return rows
    .map((row) => `- [${row.normalized_key ?? `memory-${row.id}`}] ${row.summary}`)
    .join('\n');
}

function buildCurrentWeekContext(currPlan: WeeklyPlan, currWeek: string): string {
  const doneThisWeek: string[] = [];
  const pendingThisWeek: string[] = [];

  for (const day of Object.values(currPlan.days)) {
    for (const task of day.tasks) {
      if (task.completed) {
        doneThisWeek.push(task.text);
      } else {
        pendingThisWeek.push(task.text);
      }
    }
  }

  return `An existing plan already exists for this week (${currWeek}).
Goals set earlier: ${currPlan.weeklyGoals.join('; ')}
Already completed this week (${doneThisWeek.length}): ${doneThisWeek.length > 0 ? doneThisWeek.map((task) => `  - ${task}`).join('\n') : '  (none)'}
Still pending in original plan (${pendingThisWeek.length}): ${pendingThisWeek.length > 0 ? pendingThisWeek.map((task) => `  - ${task}`).join('\n') : '  (none)'}`;
}

function buildPreviousWeekSummary(prevPlan: WeeklyPlan | null): string {
  if (!prevPlan) {
    return 'No previous week data available.';
  }

  const completedTasks: string[] = [];
  const skippedTasks: string[] = [];
  for (const day of Object.values(prevPlan.days)) {
    for (const task of day.tasks) {
      if (task.completed) {
        completedTasks.push(task.text);
      } else {
        skippedTasks.push(task.text);
      }
    }
  }

  const planned = completedTasks.length + skippedTasks.length;
  const pct = planned > 0 ? Math.round((completedTasks.length / planned) * 100) : 0;
  return `Week ${prevPlan.week} — ${completedTasks.length}/${planned} tasks completed (${pct}%)
Goals: ${prevPlan.weeklyGoals.join('; ')}
Completed: ${completedTasks.length > 0 ? completedTasks.map((task) => `  - ${task}`).join('\n') : '  (none)'}
Skipped/not done: ${skippedTasks.length > 0 ? skippedTasks.map((task) => `  - ${task}`).join('\n') : '  (none)'}`;
}

function getRollingCompletionAverage(limit = 6): number | null {
  const db = getHopperDb();
  const rows = db
    .prepare(`
      SELECT *
      FROM svc_weekly_review_plans
      WHERE week != ?
      ORDER BY interviewed_at DESC, id DESC
      LIMIT ?
    `)
    .all(getCurrentWeekString(), limit) as PlanRow[];

  if (rows.length === 0) {
    return null;
  }

  let weightedCompletion = 0;
  let totalWeight = 0;
  rows.forEach((row, index) => {
    const plan = loadPlanFromRow(row);
    if (!plan) {
      return;
    }

    const assignedCount = countPlanTasks(plan);
    if (assignedCount === 0) {
      return;
    }

    const completedCount = countCompletedTasks(plan);
    const weight = rows.length - index;
    weightedCompletion += (completedCount / assignedCount) * weight;
    totalWeight += weight;
  });

  if (totalWeight === 0) {
    return null;
  }

  return roundTo(weightedCompletion / totalWeight, 2);
}

function sanitizeStateUpdates(updates: ExtractedStateUpdate[]): ExtractedStateUpdate[] {
  const sanitized = new Map<string, ExtractedStateUpdate>();

  for (const update of updates) {
    if (update.key === PROFILE_STATE_KEYS.maxDailyTasks) {
      const value = typeof update.value === 'number'
        ? Math.round(update.value)
        : parseInt(String(update.value), 10);
      if (Number.isFinite(value) && value > 0 && value <= 12) {
        sanitized.set(update.key, {
          key: update.key,
          value,
          confidence: clamp(update.confidence),
        });
      }
      continue;
    }

    if (update.key === PROFILE_STATE_KEYS.prefersDeepWorkMornings) {
      const rawValue =
        typeof update.value === 'boolean'
          ? update.value
          : String(update.value).toLowerCase() === 'true';
      sanitized.set(update.key, {
        key: update.key,
        value: rawValue,
        confidence: clamp(update.confidence),
      });
    }
  }

  return Array.from(sanitized.values());
}

function persistLearningUpdate(
  reviewId: number,
  plan: WeeklyPlan,
  extracted: ExtractedLearningUpdate,
): void {
  const db = getHopperDb();
  const stateUpdates = sanitizeStateUpdates(extracted.stateUpdates);
  const rollingCompletionAverage = getRollingCompletionAverage();
  if (rollingCompletionAverage != null) {
    stateUpdates.push({
      key: PROFILE_STATE_KEYS.avgWeeklyCompletion,
      value: rollingCompletionAverage,
      confidence: 0.85,
    });
  }

  const persisted = db.transaction(() => {
    for (const update of stateUpdates) {
      upsertProfileState(update.key, update.value, update.confidence);
    }

    for (const memory of extracted.memoryCandidates.slice(0, RELEVANT_MEMORY_LIMIT)) {
      upsertMemoryItem({
        reviewSnapshotId: reviewId,
        kind: memory.kind,
        normalizedKey: memory.normalizedKey,
        summary: memory.summary.trim(),
        detail: memory.detailSummary.trim()
          ? { summary: memory.detailSummary.trim() }
          : {},
        confidence: clamp(memory.confidence),
        evidence: memory.evidence ?? [],
      });
    }

    const savedPlan = loadPlanFromDb(plan.week) ?? plan;
    const plannedCount = countPlanTasks(savedPlan);
    const completedCount = countCompletedTasks(savedPlan);
    const outcomeNotes = extracted.weeklyOutcome.notes?.trim() || `Goals: ${plan.weeklyGoals.join('; ') || 'none'}`;
    upsertMemoryItem({
      reviewSnapshotId: reviewId,
      kind: 'weekly_outcome',
      normalizedKey: `weekly_outcome.review_${reviewId}`,
      summary: `${plan.week}: ${completedCount}/${plannedCount} completed at review time. ${outcomeNotes}`,
      detail: {
        week: plan.week,
        planned: plannedCount,
        completed: completedCount,
        notes: outcomeNotes,
      },
      confidence: 0.8,
      evidence: [
        {
          sourceType: 'review_snapshot',
          sourceRef: String(reviewId),
          excerpt: `Goals: ${plan.weeklyGoals.join('; ') || 'none'}`,
          weight: 0.8,
        },
      ],
    });
  });

  persisted();
}

function decrementCount(map: Map<string, number>, key: string): boolean {
  const count = map.get(key) ?? 0;
  if (count <= 0) {
    return false;
  }

  if (count === 1) {
    map.delete(key);
  } else {
    map.set(key, count - 1);
  }

  return true;
}

function buildCompletionSummary(plan: WeeklyPlan): WeeklyReviewCompletionSummary | null {
  if (plan.week.localeCompare(getCurrentWeekString()) >= 0) {
    return null;
  }

  const activePlan = loadPlanFromDb(plan.week);
  if (!activePlan) {
    return null;
  }

  const completedByThoughtId = new Map<string, number>();
  const completedByText = new Map<string, number>();

  for (const task of flattenPlanTasks(activePlan)) {
    if (!task.completed) {
      continue;
    }

    if (task.thought_id != null) {
      const thoughtKey = String(task.thought_id);
      completedByThoughtId.set(thoughtKey, (completedByThoughtId.get(thoughtKey) ?? 0) + 1);
    }

    completedByText.set(task.text, (completedByText.get(task.text) ?? 0) + 1);
  }

  let completedCount = 0;
  const assignedCount = countPlanTasks(plan);

  for (const task of flattenPlanTasks(plan)) {
    if (task.thought_id != null && decrementCount(completedByThoughtId, String(task.thought_id))) {
      completedCount += 1;
      continue;
    }

    if (decrementCount(completedByText, task.text)) {
      completedCount += 1;
    }
  }

  return {
    completedCount,
    assignedCount,
  };
}

function buildReviewSummary(row: ReviewSnapshotRow, plan: WeeklyPlan): WeeklyReviewSummary {
  return {
    id: row.id,
    week: row.week,
    interviewedAt: row.interviewed_at,
    weeklyGoals: plan.weeklyGoals,
    dayCount: Object.keys(plan.days).length,
    taskCount: countPlanTasks(plan),
    completionSummary: buildCompletionSummary(plan),
  };
}

function loadPlanFromRow(planRow: PlanRow): WeeklyPlan | null {
  const db = getHopperDb();

  const taskRows = db
    .prepare('SELECT * FROM svc_weekly_review_tasks WHERE plan_id = ? ORDER BY scheduled_date, sort_order')
    .all(planRow.id) as TaskRow[];

  const deferredRows = db
    .prepare('SELECT * FROM svc_weekly_review_deferred WHERE plan_id = ?')
    .all(planRow.id) as DeferredRow[];

  const days: Record<string, DailyPlan> = {};
  for (const row of taskRows) {
    if (!days[row.scheduled_date]) {
      days[row.scheduled_date] = { focus: row.day_focus ?? '', tasks: [] };
    }
    days[row.scheduled_date].tasks.push({
      id: row.id,
      thought_id: row.thought_id,
      text: row.task_text,
      completed: row.completed === 1,
    });
  }

  return {
    week: planRow.week,
    interviewedAt: planRow.interviewed_at,
    weeklyGoals: JSON.parse(planRow.weekly_goals),
    days,
    unscheduled: deferredRows.filter((row) => row.status === 'unscheduled').map((row) => row.task_text),
    dropped: deferredRows.filter((row) => row.status === 'dropped').map((row) => row.task_text),
  };
}

function loadActivePlanRow(week: string): PlanRow | null {
  const db = getHopperDb();

  const planRow = db
    .prepare('SELECT * FROM svc_weekly_review_plans WHERE week = ?')
    .get(week) as PlanRow | undefined;

  return planRow ?? null;
}

function loadPlanFromDb(week: string): WeeklyPlan | null {
  const planRow = loadActivePlanRow(week);
  if (!planRow) {
    return null;
  }
  return loadPlanFromRow(planRow);
}

function saveReviewSnapshot(plan: WeeklyPlan): number {
  const db = getHopperDb();
  const result = db.prepare(`
    INSERT INTO svc_weekly_review_review_snapshots (week, interviewed_at, plan_json)
    VALUES (?, ?, ?)
  `).run(plan.week, plan.interviewedAt, JSON.stringify(plan));

  return Number(result.lastInsertRowid);
}

function backfillReviewSnapshots(): void {
  const db = getHopperDb();
  const planRows = db
    .prepare('SELECT * FROM svc_weekly_review_plans ORDER BY interviewed_at DESC, id DESC')
    .all() as PlanRow[];

  for (const planRow of planRows) {
    const existing = db
      .prepare(`
        SELECT 1
        FROM svc_weekly_review_review_snapshots
        WHERE week = ? AND interviewed_at = ?
        LIMIT 1
      `)
      .get(planRow.week, planRow.interviewed_at);

    if (existing) {
      continue;
    }

    const plan = loadPlanFromRow(planRow);
    if (plan) {
      saveReviewSnapshot(plan);
    }
  }
}

backfillReviewSnapshots();
migrateLegacyProfileToDb();

// ── Public API ────────────────────────────────────────────────────────────────

export function getInterviewStatus(): InterviewStatus {
  const week = getCurrentWeekString();
  const plan = loadPlanFromDb(week);
  return {
    needed: plan === null,
    week,
  };
}

export function getTodayPlan(): DailyPlan | null {
  const week = getCurrentWeekString();
  const plan = loadPlanFromDb(week);
  if (!plan) return null;

  const today = getTodayDateString();
  return plan.days[today] || null;
}

export function getWeeklyGoals(): string[] {
  const week = getCurrentWeekString();
  const plan = loadPlanFromDb(week);
  if (!plan) return [];
  return plan.weeklyGoals;
}

export function getPlanForDate(dateStr: string): DailyPlan | null {
  const week = getWeekStringForDate(dateStr);
  const plan = loadPlanFromDb(week);
  if (!plan) return null;
  return plan.days[dateStr] || null;
}

export function getWeeklyGoalsForDate(dateStr: string): string[] {
  const week = getWeekStringForDate(dateStr);
  const plan = loadPlanFromDb(week);
  if (!plan) return [];
  return plan.weeklyGoals;
}

export function toggleTask(dateStr: string, taskIndex: number): DailyTask {
  const db = getHopperDb();
  const week = getWeekStringForDate(dateStr);

  const planRow = db
    .prepare('SELECT id FROM svc_weekly_review_plans WHERE week = ?')
    .get(week) as { id: number } | undefined;
  if (!planRow) throw new Error('No weekly plan exists');

  const tasks = db
    .prepare(
      'SELECT * FROM svc_weekly_review_tasks WHERE plan_id = ? AND scheduled_date = ? ORDER BY sort_order'
    )
    .all(planRow.id, dateStr) as TaskRow[];

  const task = tasks[taskIndex];
  if (!task) throw new Error(`No task at index: ${taskIndex}`);

  const newCompleted = task.completed === 0 ? 1 : 0;
  const completedAt = newCompleted === 1 ? new Date().toISOString() : null;

  db.prepare(
    'UPDATE svc_weekly_review_tasks SET completed = ?, completed_at = ? WHERE id = ?'
  ).run(newCompleted, completedAt, task.id);

  return {
    id: task.id,
    thought_id: task.thought_id,
    text: task.task_text,
    completed: newCompleted === 1,
  };
}

export function listSavedReviews(): WeeklyReviewSummary[] {
  const db = getHopperDb();
  const rows = db
    .prepare(`
      SELECT *
      FROM svc_weekly_review_review_snapshots
      ORDER BY interviewed_at DESC, id DESC
    `)
    .all() as ReviewSnapshotRow[];

  return rows.map((row) => {
    const plan = parseWeeklyPlan(row.plan_json);
    return buildReviewSummary(row, plan);
  });
}

export function getSavedReview(reviewId: number): WeeklyReviewRecord | null {
  const db = getHopperDb();
  const row = db
    .prepare('SELECT * FROM svc_weekly_review_review_snapshots WHERE id = ?')
    .get(reviewId) as ReviewSnapshotRow | undefined;

  if (!row) {
    return null;
  }

  const plan = parseWeeklyPlan(row.plan_json);
  return {
    ...buildReviewSummary(row, plan),
    plan,
  };
}

export function getWeeklyContext(retrievalQuery = ''): WeeklyContext {
  const db = getHopperDb();

  // All active todos from Hopper (category=todo, not dropped from a plan)
  interface ThoughtRow { id: number; raw_input: string; }
  const pendingTodos = db
    .prepare(`
      SELECT t.id, t.raw_input
      FROM thoughts t
      WHERE t.category = 'todo'
        AND t.id NOT IN (
          SELECT d.thought_id FROM svc_weekly_review_deferred d
          WHERE d.status = 'dropped' AND d.thought_id IS NOT NULL
        )
        AND t.id NOT IN (
          SELECT wrt.thought_id FROM svc_weekly_review_tasks wrt
          WHERE wrt.completed = 1 AND wrt.thought_id IS NOT NULL
        )
        AND t.id NOT IN (
          SELECT dc.thought_id FROM svc_dashboard_completions dc
        )
      ORDER BY t.created_at ASC
    `)
    .all() as ThoughtRow[];

  const currentTodos = pendingTodos
    .map(t => `[${t.id}] ${t.raw_input}`)
    .join('\n');

  const prevWeek = getPreviousWeekString();
  const prevPlan = loadPlanFromDb(prevWeek);
  const previousWeekSummary = buildPreviousWeekSummary(prevPlan);

  const currWeek = getCurrentWeekString();
  const currPlan = loadPlanFromDb(currWeek);
  const currentWeekContext = currPlan ? buildCurrentWeekContext(currPlan, currWeek) : '';
  const profileStateSummary = buildProfileStateSummary();
  const retrievalSeed = [retrievalQuery, previousWeekSummary, currentWeekContext, currentTodos]
    .filter(Boolean)
    .join('\n\n');
  const relevantMemorySummary = buildRelevantMemorySummary(retrievalSeed);
  const recentOutcomeSummary = buildRecentOutcomeSummary();

  return {
    currentTodos,
    previousWeekSummary,
    currentWeekContext,
    profileStateSummary,
    relevantMemorySummary,
    recentOutcomeSummary,
  };
}

export function savePlan(plan: WeeklyPlan): void {
  const db = getHopperDb();

  // Upsert the plan header
  db.prepare(`
    INSERT INTO svc_weekly_review_plans (week, weekly_goals, interviewed_at)
    VALUES (?, ?, ?)
    ON CONFLICT(week) DO UPDATE SET
      weekly_goals = excluded.weekly_goals,
      interviewed_at = excluded.interviewed_at
  `).run(plan.week, JSON.stringify(plan.weeklyGoals), plan.interviewedAt);

  const planRow = db
    .prepare('SELECT id FROM svc_weekly_review_plans WHERE week = ?')
    .get(plan.week) as { id: number };
  const planId = planRow.id;

  // Capture existing completion state before replacing tasks (for redo continuity)
  interface CompletedRow { thought_id: number | null; task_text: string; completed_at: string; }
  const prevCompleted = db
    .prepare('SELECT thought_id, task_text, completed_at FROM svc_weekly_review_tasks WHERE plan_id = ? AND completed = 1')
    .all(planId) as CompletedRow[];
  const completedByThoughtId = new Map(
    prevCompleted.filter(r => r.thought_id != null).map(r => [r.thought_id!, r.completed_at])
  );
  const completedByText = new Map(prevCompleted.map(r => [r.task_text, r.completed_at]));

  // Replace tasks and deferred for this plan
  db.prepare('DELETE FROM svc_weekly_review_tasks WHERE plan_id = ?').run(planId);
  db.prepare('DELETE FROM svc_weekly_review_deferred WHERE plan_id = ?').run(planId);

  for (const [date, day] of Object.entries(plan.days)) {
    for (let i = 0; i < day.tasks.length; i++) {
      const task = day.tasks[i];
      const prevCompletedAt =
        (task.thought_id != null ? completedByThoughtId.get(task.thought_id) : undefined) ??
        completedByText.get(task.text) ??
        null;
      const isCompleted = prevCompletedAt != null ? 1 : (task.completed ? 1 : 0);
      const completedAt = prevCompletedAt ?? (task.completed ? new Date().toISOString() : null);
      db.prepare(`
        INSERT INTO svc_weekly_review_tasks
          (plan_id, thought_id, scheduled_date, day_focus, task_text, sort_order, completed, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        planId,
        task.thought_id ?? null,
        date,
        day.focus,
        task.text,
        i,
        isCompleted,
        completedAt
      );
    }
  }

  for (const text of plan.unscheduled) {
    db.prepare(`
      INSERT INTO svc_weekly_review_deferred (plan_id, thought_id, task_text, status)
      VALUES (?, ?, ?, 'unscheduled')
    `).run(planId, null, text);
  }

  for (const text of plan.dropped) {
    db.prepare(`
      INSERT INTO svc_weekly_review_deferred (plan_id, thought_id, task_text, status)
      VALUES (?, ?, ?, 'dropped')
    `).run(planId, null, text);
  }
}

const LEARNING_UPDATE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    stateUpdates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: [
              PROFILE_STATE_KEYS.maxDailyTasks,
              PROFILE_STATE_KEYS.prefersDeepWorkMornings,
            ],
          },
          value: {
            anyOf: [
              { type: 'integer' },
              { type: 'boolean' },
              { type: 'string' },
            ],
          },
          confidence: { type: 'number' },
        },
        required: ['key', 'value', 'confidence'],
        additionalProperties: false,
      },
    },
    memoryCandidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['energy_pattern', 'completion_pattern', 'workflow_pattern', 'work_preference'],
          },
          normalizedKey: {
            anyOf: [
              { type: 'string' },
              { type: 'null' },
            ],
          },
          summary: { type: 'string' },
          detailSummary: { type: 'string' },
          confidence: { type: 'number' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sourceType: { type: 'string' },
                sourceRef: { type: 'string' },
                excerpt: { type: 'string' },
                weight: { type: 'number' },
              },
              required: ['sourceType', 'sourceRef', 'excerpt', 'weight'],
              additionalProperties: false,
            },
          },
        },
        required: ['kind', 'normalizedKey', 'summary', 'detailSummary', 'confidence', 'evidence'],
        additionalProperties: false,
      },
    },
    weeklyOutcome: {
      type: 'object',
      properties: {
        notes: {
          anyOf: [
            { type: 'string' },
            { type: 'null' },
          ],
        },
      },
      required: ['notes'],
      additionalProperties: false,
    },
  },
  required: ['stateUpdates', 'memoryCandidates', 'weeklyOutcome'],
  additionalProperties: false,
} as const;

assertStrictStructuredOutputSchema(LEARNING_UPDATE_OUTPUT_SCHEMA, 'LEARNING_UPDATE_OUTPUT_SCHEMA');

export function updateProfileAfterReview(
  messages: ChatMessage[],
  plan: WeeklyPlan,
  reviewId: number,
): void {
  const previousWeekSummary = buildPreviousWeekSummary(loadPlanFromDb(getPreviousWeekString()));
  const conversationText = messages
    .map((message) => (message.role === 'user' ? `Human: ${message.content}` : `Assistant: ${message.content}`))
    .join('\n\n');
  const prompt = `You are extracting durable weekly planning learnings into structured memory records.

Current exact profile state:
${buildProfileStateSummary()}

Current active memory records:
${buildActiveMemorySummary()}

Recent weekly outcomes:
${buildRecentOutcomeSummary()}

Last week's completion summary:
${previousWeekSummary}

This week's generated plan:
Week: ${plan.week}
Goals: ${plan.weeklyGoals.join('; ') || 'none'}
Planned task count: ${countPlanTasks(plan)}
Unscheduled: ${plan.unscheduled.join('; ') || 'none'}
Dropped: ${plan.dropped.join('; ') || 'none'}

Weekly review conversation:
${conversationText}

Return JSON only. Rules:
- Record only durable planning learnings that are likely useful in future weeks.
- Prefer stable concept-level normalized keys, for example "completion_pattern.defer_uncertain_experiments".
- Do not duplicate active memories with slightly different wording.
- Keep memoryCandidates to at most 6.
- Use stateUpdates only for exact scalar preferences.
- weeklyOutcome.notes should be one sentence about this review's planning outcome.`;

  void (async () => {
    try {
      const raw = await runCodexStructuredTask(prompt, LEARNING_UPDATE_OUTPUT_SCHEMA);
      const extracted = safeJsonParse<ExtractedLearningUpdate>(raw, {
        stateUpdates: [],
        memoryCandidates: [],
        weeklyOutcome: { notes: null },
      });
      persistLearningUpdate(reviewId, plan, extracted);
    } catch (err) {
      console.error('[profile-update] codex failed:', (err as Error).message);
      persistLearningUpdate(reviewId, plan, {
        stateUpdates: [],
        memoryCandidates: [],
        weeklyOutcome: { notes: null },
      });
    }
  })();
}

// ── Agent prompts ─────────────────────────────────────────────────────────────

const INTERVIEW_SYSTEM_PROMPT = `You are a weekly planning assistant helping the user organize their todo list into daily plans. You conduct a brief, focused interview (~5-10 minutes).

## Interview Flow
1. Retrospective: Open by presenting your analysis of last week — what was accomplished, what was skipped, and how well the completed work aligned with the goals that were set. Ask if this matches their experience or if there's context you're missing. Do NOT ask them to recall what happened; you have the data.
2. Weekly goals: Ask "What are your goals this week?" — these become the lens for all prioritization decisions.
3. Triage: Walk through this week's items. For recurring deferrals, ask: keep, reschedule, or drop? Use weekly goals to guide which items matter most.
4. Daily distribution: Propose tasks for each remaining day this week, organized around the weekly goals.
5. Calibration: Does this daily breakdown feel realistic?

## Redo behavior
If an existing plan is provided for this week, open by acknowledging it: note what's already been completed, what's still pending, and ask what prompted the redo (goals changed, plan needs adjustment, etc.). Preserve already-completed tasks in the new plan.

## Rules
- Do NOT ask the user to tag, categorize, or estimate durations for tasks
- Infer task types and priorities from context and conversation
- Use the weekly goals as the primary organizing principle — tasks that advance the goals should be prioritized
- Keep the interview conversational and efficient
- Learn from what the user tells you — note patterns for the profile
- When proposing the daily plan, explain your reasoning briefly

## Actions
When you and the user agree that a todo is complete, emit an action tag on its own line:
<action type="complete_todo" thought_id="42" />
The system processes this automatically and removes it from visible output.
Only use IDs from the provided todo list. Do not fabricate IDs.`;

const ACTION_TAG_RE = /<action\s+type="complete_todo"\s+thought_id="(\d+)"\s*\/>/g;

function stripActionTags(text: string): string {
  return text.replace(ACTION_TAG_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function executeActions(fullText: string): void {
  let match: RegExpExecArray | null;
  const re = new RegExp(ACTION_TAG_RE.source, 'g');
  while ((match = re.exec(fullText)) !== null) {
    const thoughtId = parseInt(match[1], 10);
    if (!isNaN(thoughtId)) {
      const found = completeTodo(thoughtId, 'agent');
      if (found) {
        console.log(`[interview] agent completed todo ${thoughtId}`);
      } else {
        console.warn(`[interview] agent tried to complete unknown todo ${thoughtId}`);
      }
    }
  }
}

function getLatestUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  throw new Error('No user message found');
}

function buildInterviewPrompt(messages: ChatMessage[], hasActiveSession: boolean): string {
  const latestUserMessage = hasActiveSession ? getLatestUserMessage(messages) : '';
  const retrievalQuery = hasActiveSession
    ? latestUserMessage
    : messages.map((message) => message.content).join('\n\n');
  const context = getWeeklyContext(retrievalQuery);
  const systemBlock = `${INTERVIEW_SYSTEM_PROMPT}

## Exact Profile State
${context.profileStateSummary}

## Relevant Learned Patterns
${context.relevantMemorySummary}

## Recent Weekly Outcomes
${context.recentOutcomeSummary}

## Current Todo List (ID: text)
${context.currentTodos}

## Last Week's Results
${context.previousWeekSummary}${context.currentWeekContext ? `\n\n## This Week's Existing Plan (Redo)\n${context.currentWeekContext}` : ''}`;

  if (hasActiveSession) {
    return `${systemBlock}\n\nContinue the ongoing weekly review. The user's latest message is:\nHuman: ${latestUserMessage}`;
  }

  const conversationLines = messages.map(m =>
    m.role === 'user' ? `Human: ${m.content}` : `Assistant: ${m.content}`
  );

  return `${systemBlock}\n\n${conversationLines.join('\n\n')}`;
}

export function streamInterview(
  messages: ChatMessage[],
  sessionId: string | null,
  res: Response,
): Promise<void> {
  const hasActiveSession = !!(sessionId && sessionManager.get(sessionId, 'weekly-review'));
  const prompt = buildInterviewPrompt(messages, hasActiveSession);

  return streamCodexTurn({
    kind: 'weekly-review',
    sessionId,
    input: prompt,
    response: res,
    transformText: stripActionTags,
    onComplete: (fullResponseText) => {
      if (fullResponseText) {
        executeActions(fullResponseText);
      }
    },
  });
}

function buildFinalizeSystemPrompt(maxDailyTasks: number): string {
  return `You are a weekly planning assistant. Based on the conversation below, generate a structured weekly plan as JSON.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no code fences. Just the raw JSON object.

The JSON must match this exact schema:
{
  "weeklyGoals": ["goal 1", "goal 2"],
  "days": [
    {
      "date": "YYYY-MM-DD",
      "focus": "Focus area for this day",
      "tasks": [
        {
          "text": "Human-readable task description",
          "thought_id": 42,
          "completed": false
        }
      ]
    }
  ],
  "unscheduled": ["task texts intentionally deferred"],
  "dropped": ["task texts the user decided to drop"]
}

Rules:
- Only include days from today through the rest of the week (Monday-Sunday)
- The "thought_id" field must be the integer ID from the todo list provided (e.g. 42 for "[42] Some task"). Use null if the task was not in the provided list.
- Set completed to false for all tasks
- Keep max ${maxDailyTasks} tasks per day unless the user specifically requested more
- Respect any preferences expressed in the conversation`;
}

const WEEKLY_PLAN_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    weeklyGoals: {
      type: 'array',
      items: { type: 'string' },
    },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          focus: { type: 'string' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                thought_id: {
                  anyOf: [
                    { type: 'integer' },
                    { type: 'null' },
                  ],
                },
                completed: { type: 'boolean' },
              },
              required: ['text', 'thought_id', 'completed'],
              additionalProperties: false,
            },
          },
        },
        required: ['date', 'focus', 'tasks'],
        additionalProperties: false,
      },
    },
    unscheduled: {
      type: 'array',
      items: { type: 'string' },
    },
    dropped: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['weeklyGoals', 'days', 'unscheduled', 'dropped'],
  additionalProperties: false,
} as const;

assertStrictStructuredOutputSchema(WEEKLY_PLAN_OUTPUT_SCHEMA, 'WEEKLY_PLAN_OUTPUT_SCHEMA');

export function generatePlan(
  messages: ChatMessage[],
): Promise<FinalizedWeeklyReview> {
  return (async () => {
    const conversationText = messages.map((message) =>
      message.role === 'user' ? `Human: ${message.content}` : `Assistant: ${message.content}`
    ).join('\n\n');
    const context = getWeeklyContext(conversationText);
    const week = getCurrentWeekString();
    const maxDailyTasks = getProfileStateValue<number>(PROFILE_STATE_KEYS.maxDailyTasks) ?? 5;

    const prompt = `${buildFinalizeSystemPrompt(maxDailyTasks)}

## Exact Profile State
${context.profileStateSummary}

## Relevant Learned Patterns
${context.relevantMemorySummary}

## Recent Weekly Outcomes
${context.recentOutcomeSummary}

## Current Todo List (ID: text)
${context.currentTodos}

## Last Week's Results
${context.previousWeekSummary}${context.currentWeekContext ? `\n\n## This Week's Existing Plan (Redo)\n${context.currentWeekContext}` : ''}

## Conversation
${conversationText}

Today's date is ${getTodayDateString()}. The current week is ${week}.

Generate the JSON plan now:`;

    const text = await runCodexStructuredTask(prompt, WEEKLY_PLAN_OUTPUT_SCHEMA);
    const planData = JSON.parse(text);

    const dayEntries = Array.isArray(planData.days) ? planData.days as PlannedDayOutput[] : [];
    const days = dayEntries.reduce<Record<string, DailyPlan>>((acc, day) => {
      acc[day.date] = {
        focus: day.focus,
        tasks: day.tasks.map((task) => ({
          id: 0,
          thought_id: task.thought_id,
          text: task.text,
          completed: task.completed,
        })),
      };
      return acc;
    }, {});

    const plan: WeeklyPlan = {
      week,
      interviewedAt: new Date().toISOString(),
      weeklyGoals: planData.weeklyGoals || [],
      days,
      unscheduled: planData.unscheduled || [],
      dropped: planData.dropped || [],
    };

    savePlan(plan);
    const reviewId = saveReviewSnapshot(plan);

    return {
      reviewId,
      plan,
    };
  })();
}
