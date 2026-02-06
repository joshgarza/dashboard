import * as fs from 'fs';
import * as path from 'path';

interface WeeklyTodoSummary {
  noteTitle: string;
  completed: number;
  total: number;
  weekOf: string;
}

const VAULT_PATH = '/mnt/c/Users/josh/OneDrive/Documents/Obsidian/Obsidian Vault';

export function getCurrentWeekNote(): WeeklyTodoSummary {
  const now = new Date();
  const year = now.getFullYear();
  const week = getISOWeek(now);
  const noteTitle = `${year} Week ${String(week).padStart(2, '0')}`;
  const filePath = path.join(VAULT_PATH, `${noteTitle}.md`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Weekly note not found: ${noteTitle}.md`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return parseWeeklyNote(content, noteTitle);
}

function parseWeeklyNote(content: string, noteTitle: string): WeeklyTodoSummary {
  const weekOfMatch = content.match(/## Week of (.+)/);
  const weekOf = weekOfMatch ? weekOfMatch[1] : '';

  const incompleteMatches = content.match(/- \[ \]/g) || [];
  const completeMatches = content.match(/- \[x\]/gi) || [];

  return {
    noteTitle,
    completed: completeMatches.length,
    total: incompleteMatches.length + completeMatches.length,
    weekOf,
  };
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export type { WeeklyTodoSummary };
