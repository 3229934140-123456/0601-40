import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/error.middleware';

import sessionRoutes from './routes/session.routes';
import documentRoutes from './routes/document.routes';
import taskRoutes from './routes/task.routes';
import knowledgeRoutes from './routes/knowledge.routes';
import auditRoutes from './routes/audit.routes';
import statsRoutes from './routes/stats.routes';
import adminRoutes from './routes/admin.routes';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
    },
  });
});

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'AI 应用平台后端服务',
    version: '1.0.0',
    docs: {
      sessions: '/api/v1/sessions',
      documents: '/api/v1/documents',
      tasks: '/api/v1/tasks',
      knowledge: '/api/v1/knowledge',
      audit: '/api/v1/audit',
      stats: '/api/v1/stats',
      admin: '/api/v1/admin',
    },
  });
});

app.use('/api/v1/sessions', sessionRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/knowledge', knowledgeRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1/admin', adminRoutes);

app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: '接口不存在',
      retrySuggestion: '请检查请求的 URL 和 HTTP 方法是否正确',
    },
  });
});

export default app;
