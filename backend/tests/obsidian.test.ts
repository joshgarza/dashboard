import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../src/middleware/errorHandler.js';

// Mock fs module
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();

jest.unstable_mockModule('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

const { obsidianRouter } = await import('../src/routes/obsidian.js');

const app = express();
app.use(express.json());
app.use('/api', obsidianRouter);
app.use(errorHandler);

describe('Obsidian API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /api/obsidian/weekly-todos', () => {
    const sampleNoteContent = `---
created: "[[2026-02-02]]"
tags:
  - weekly
  - todo
week: "[[2026-W05]]"
---
## Week of February 02, 2026

### Todo
- [ ] Task 1
- [x] Task 2 completed
- [ ] Task 3
  - [ ] Nested task
  - [x] Nested completed
- [x] Task 4 completed

### Notes
Some notes here
`;

    it('returns todo summary with correct counts', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(sampleNoteContent);

      const response = await request(app).get('/api/obsidian/weekly-todos');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.completed).toBe(3); // [x] items
      expect(response.body.data.total).toBe(6); // All [ ] and [x] items
    });

    it('returns note title based on current week', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(sampleNoteContent);

      const response = await request(app).get('/api/obsidian/weekly-todos');

      expect(response.body.data.noteTitle).toMatch(/^\d{4} Week \d{2}$/);
    });

    it('extracts weekOf from note header', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(sampleNoteContent);

      const response = await request(app).get('/api/obsidian/weekly-todos');

      expect(response.body.data.weekOf).toBe('February 02, 2026');
    });

    it('handles note with no todos', async () => {
      const emptyTodoNote = `---
created: "[[2026-02-02]]"
---
## Week of February 02, 2026

### Todo

### Notes
Just notes, no todos
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(emptyTodoNote);

      const response = await request(app).get('/api/obsidian/weekly-todos');

      expect(response.status).toBe(200);
      expect(response.body.data.completed).toBe(0);
      expect(response.body.data.total).toBe(0);
    });

    it('handles all todos completed', async () => {
      const allCompletedNote = `---
created: "[[2026-02-02]]"
---
## Week of February 02, 2026

### Todo
- [x] Done 1
- [x] Done 2
- [x] Done 3
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(allCompletedNote);

      const response = await request(app).get('/api/obsidian/weekly-todos');

      expect(response.body.data.completed).toBe(3);
      expect(response.body.data.total).toBe(3);
    });

    it('returns 500 when weekly note file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const response = await request(app).get('/api/obsidian/weekly-todos');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });

    it('handles missing weekOf header gracefully', async () => {
      const noHeaderNote = `---
created: "[[2026-02-02]]"
---
### Todo
- [ ] Task 1
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(noHeaderNote);

      const response = await request(app).get('/api/obsidian/weekly-todos');

      expect(response.status).toBe(200);
      expect(response.body.data.weekOf).toBe('');
    });

    it('counts case-insensitive [X] as completed', async () => {
      const mixedCaseNote = `---
created: "[[2026-02-02]]"
---
## Week of February 02, 2026

### Todo
- [x] lowercase x
- [X] uppercase X
- [ ] incomplete
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(mixedCaseNote);

      const response = await request(app).get('/api/obsidian/weekly-todos');

      expect(response.body.data.completed).toBe(2);
      expect(response.body.data.total).toBe(3);
    });
  });
});
