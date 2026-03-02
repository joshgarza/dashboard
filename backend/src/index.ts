import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { devicesRouter } from './routes/devices.js';
import { crmRouter } from './routes/crm.js';
import { obsidianRouter } from './routes/obsidian.js';
import { calendarRouter } from './routes/calendar.js';
import { researchRouter } from './routes/research.js';
import { weeklyReviewRouter } from './routes/weeklyReview.js';
import { leadGenSourcesRouter } from './routes/leadGenSources.js';
import { todosRouter } from './routes/todos.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', devicesRouter);
app.use('/api', crmRouter);
app.use('/api', obsidianRouter);
app.use('/api', calendarRouter);
app.use('/api', researchRouter);
app.use('/api', weeklyReviewRouter);
app.use('/api', leadGenSourcesRouter);
app.use('/api', todosRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});

export default app;
