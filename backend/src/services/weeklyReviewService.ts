import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { Response } from 'express';
import type {
  WeeklyPlan,
  DailyPlan,
  DailyTask,
  ChatMessage,
  InterviewStatus,
  WeeklyContext,
} from '../types/weeklyReview.js';

const DATA_PATH = path.resolve(import.meta.dirname, '../../data');
const PLANS_PATH = path.join(DATA_PATH, 'weekly-plans');
const PROFILE_PATH = path.join(DATA_PATH, 'learning-profile.yaml');
const VAULT_PATH = '/mnt/c/Users/josh/OneDrive/Documents/Obsidian/Obsidian Vault';

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

function getPlanPath(week: string): string {
  return path.join(PLANS_PATH, `${week}.json`);
}

function loadPlan(week: string): WeeklyPlan | null {
  const planPath = getPlanPath(week);
  if (!fs.existsSync(planPath)) return null;
  return JSON.parse(fs.readFileSync(planPath, 'utf-8'));
}

function savePlanToFile(plan: WeeklyPlan): void {
  if (!fs.existsSync(PLANS_PATH)) {
    fs.mkdirSync(PLANS_PATH, { recursive: true });
  }
  fs.writeFileSync(getPlanPath(plan.week), JSON.stringify(plan, null, 2) + '\n');
}

export function getTodayDateString(): string {
  const now = getNowInPT();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeeklyNoteTitle(): string {
  const now = getNowInPT();
  const year = now.getFullYear();
  const week = getISOWeek(now);
  return `${year} Week ${String(week).padStart(2, '0')}`;
}

function getPreviousWeekString(): string {
  const now = getNowInPT();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const week = getISOWeek(weekAgo);
  return `${weekAgo.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function getInterviewStatus(): InterviewStatus {
  const week = getCurrentWeekString();
  const plan = loadPlan(week);
  return {
    needed: plan === null,
    week,
  };
}

export function getTodayPlan(): DailyPlan | null {
  const week = getCurrentWeekString();
  const plan = loadPlan(week);
  if (!plan) return null;

  const today = getTodayDateString();
  return plan.days[today] || null;
}

export function getWeeklyGoals(): string[] {
  const week = getCurrentWeekString();
  const plan = loadPlan(week);
  if (!plan) return [];
  return plan.weeklyGoals;
}

export function toggleTask(dateStr: string, taskIndex: number): DailyTask {
  const week = getCurrentWeekString();
  const plan = loadPlan(week);
  if (!plan) throw new Error('No weekly plan exists');

  const dayPlan = plan.days[dateStr];
  if (!dayPlan) throw new Error(`No plan for date: ${dateStr}`);

  const task = dayPlan.tasks[taskIndex];
  if (!task) throw new Error(`No task at index: ${taskIndex}`);

  task.completed = !task.completed;
  savePlanToFile(plan);

  // Sync back to Obsidian weekly note (non-fatal)
  try {
    syncTaskToObsidian(task, plan);
  } catch (err) {
    console.error('[weeklyReview] Obsidian sync failed (toggle still saved):', err);
  }

  return task;
}

function syncTaskToObsidian(task: DailyTask, plan: WeeklyPlan): void {
  const noteTitle = getWeeklyNoteTitle();
  const filePath = path.join(VAULT_PATH, `${noteTitle}.md`);

  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf-8');

  // Normalize source to unchecked form to derive both variants
  const unchecked = task.source.replace(/- \[x\]/i, '- [ ]');
  const checked = unchecked.replace('- [ ]', '- [x]');

  const findInNote = task.completed ? unchecked : checked;
  const replaceWith = task.completed ? checked : unchecked;

  if (content.includes(findInNote)) {
    content = content.replace(findInNote, replaceWith);
    fs.writeFileSync(filePath, content);
  }

  // Keep source in sync with the new checkbox state
  task.source = replaceWith;
  savePlanToFile(plan);
}

export function getWeeklyContext(): WeeklyContext {
  // Load current week's todos from Obsidian
  const noteTitle = getWeeklyNoteTitle();
  const filePath = path.join(VAULT_PATH, `${noteTitle}.md`);
  let currentTodos = '';
  if (fs.existsSync(filePath)) {
    currentTodos = fs.readFileSync(filePath, 'utf-8');
  }

  // Load previous week's plan summary
  const prevWeek = getPreviousWeekString();
  const prevPlan = loadPlan(prevWeek);
  let previousWeekSummary = 'No previous week data available.';
  if (prevPlan) {
    let planned = 0;
    let completed = 0;
    for (const day of Object.values(prevPlan.days)) {
      planned += day.tasks.length;
      completed += day.tasks.filter(t => t.completed).length;
    }
    previousWeekSummary = `Week ${prevPlan.week}: ${completed}/${planned} tasks completed.\nGoals: ${prevPlan.weeklyGoals.join(', ')}`;
  }

  // Load learning profile
  let profile = '';
  if (fs.existsSync(PROFILE_PATH)) {
    profile = fs.readFileSync(PROFILE_PATH, 'utf-8');
  }

  return { currentTodos, previousWeekSummary, profile };
}

export function savePlan(plan: WeeklyPlan): void {
  savePlanToFile(plan);
}

export function updateProfile(updates: string): void {
  fs.writeFileSync(PROFILE_PATH, updates);
}

const INTERVIEW_SYSTEM_PROMPT = `You are a weekly planning assistant helping the user organize their todo list into daily plans. You conduct a brief, focused interview (~5-10 minutes).

## Interview Flow
1. Weekly goals: Ask "What are your goals this week?" — these become the lens for all prioritization decisions. Tasks that serve the goals get scheduled first; tasks that don't may get deferred.
2. Brief reflection: What got done last week? What didn't? Any patterns?
3. Triage: Walk through this week's items. For recurring deferrals, ask: keep, reschedule, or drop? Use weekly goals to guide which items matter most.
4. Daily distribution: Propose tasks for each remaining day this week, organized around the weekly goals.
5. Calibration: Does this daily breakdown feel realistic?

## Rules
- Do NOT ask the user to tag, categorize, or estimate durations for tasks
- Infer task types and priorities from context and conversation
- Use the weekly goals as the primary organizing principle — tasks that advance the goals should be prioritized
- Keep the interview conversational and efficient
- Learn from what the user tells you — note patterns for the profile
- When proposing the daily plan, explain your reasoning briefly`;

export function streamInterview(
  messages: ChatMessage[],
  res: Response,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const context = getWeeklyContext();

    const systemBlock = `${INTERVIEW_SYSTEM_PROMPT}

## User Profile
${context.profile}

## This Week's Todos
${context.currentTodos}

## Last Week's Results
${context.previousWeekSummary}`;

    const conversationLines = messages.map(m =>
      m.role === 'user' ? `Human: ${m.content}` : `Assistant: ${m.content}`
    );

    const prompt = `${systemBlock}\n\n${conversationLines.join('\n\n')}`;

    const claudeBin = path.resolve(import.meta.dirname, '../../node_modules/.bin/claude');

    const child = spawn(claudeBin, ['-p', prompt, '--output-format', 'stream-json', '--verbose'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant' && event.message?.content) {
            const text = event.message.content
              .map((b: { text?: string }) => b.text || '')
              .join('');
            if (text) {
              res.write(`data: ${JSON.stringify({ type: 'content_block_delta', text })}\n\n`);
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      console.error('[claude stderr]', chunk.toString());
    });

    child.on('close', (code) => {
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (event.type === 'assistant' && event.subtype === 'text') {
            res.write(`data: ${JSON.stringify({ type: 'content_block_delta', text: event.text })}\n\n`);
          }
        } catch {
          // ignore
        }
      }
      res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}`));
      } else {
        resolve();
      }
    });

    child.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', text: `Error: ${err.message}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
      reject(err);
    });

    res.on('close', () => {
      if (!child.killed) child.kill();
    });
  });
}

const FINALIZE_SYSTEM_PROMPT = `You are a weekly planning assistant. Based on the conversation below, generate a structured weekly plan as JSON.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no code fences. Just the raw JSON object.

The JSON must match this exact schema:
{
  "weeklyGoals": ["goal 1", "goal 2"],
  "days": {
    "YYYY-MM-DD": {
      "focus": "Focus area for this day",
      "tasks": [
        {
          "text": "Human-readable task description",
          "source": "- [ ] Original markdown line from the weekly note",
          "completed": false
        }
      ]
    }
  },
  "unscheduled": ["task texts intentionally deferred"],
  "dropped": ["task texts the user decided to drop"]
}

Rules:
- Only include days from today through the rest of the week (Monday-Sunday)
- The "source" field must be the exact markdown line from the weekly note (e.g. "- [ ] Print and post POD permits")
- If a task doesn't come from the weekly note, use "- [ ] {task text}" as the source
- Set completed to false for all tasks
- Keep max 5 tasks per day unless the user specifically requested more
- Respect any preferences expressed in the conversation`;

export function generatePlan(
  messages: ChatMessage[],
): Promise<WeeklyPlan> {
  return new Promise((resolve, reject) => {
    const context = getWeeklyContext();
    const week = getCurrentWeekString();

    const conversationText = messages.map(m =>
      m.role === 'user' ? `Human: ${m.content}` : `Assistant: ${m.content}`
    ).join('\n\n');

    const prompt = `${FINALIZE_SYSTEM_PROMPT}

## This Week's Todos (for source field matching)
${context.currentTodos}

## Conversation
${conversationText}

Today's date is ${getTodayDateString()}. The current week is ${week}.

Generate the JSON plan now:`;

    const claudeBin = path.resolve(import.meta.dirname, '../../node_modules/.bin/claude');

    const child = spawn(claudeBin, ['-p', prompt, '--output-format', 'json'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        // The --output-format json wraps the response; extract the text content
        const wrapper = JSON.parse(stdout);
        let text = '';
        if (wrapper.result) {
          text = wrapper.result;
        } else if (Array.isArray(wrapper)) {
          text = wrapper.map((b: { text?: string }) => b.text || '').join('');
        } else if (typeof wrapper === 'string') {
          text = wrapper;
        } else {
          text = stdout;
        }

        // Strip any markdown code fences if present
        text = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

        const planData = JSON.parse(text);

        const plan: WeeklyPlan = {
          week,
          interviewedAt: new Date().toISOString(),
          weeklyGoals: planData.weeklyGoals || [],
          days: planData.days || {},
          unscheduled: planData.unscheduled || [],
          dropped: planData.dropped || [],
        };

        savePlanToFile(plan);
        resolve(plan);
      } catch (err) {
        reject(new Error(`Failed to parse plan JSON: ${(err as Error).message}\nRaw output: ${stdout.slice(0, 500)}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}
