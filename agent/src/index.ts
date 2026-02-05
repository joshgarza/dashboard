import express from 'express';
import cors from 'cors';
import statsRouter from './routes/stats.js';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use('/api', statsRouter);

app.listen(PORT, () => {
  console.log(`Agent server running on port ${PORT}`);
});

export default app;
