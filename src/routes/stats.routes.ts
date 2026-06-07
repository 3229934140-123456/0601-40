import { Router } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import {
  getUsageStats,
  getSummary,
  getAuditLogs,
  getTopMetrics,
} from '../controllers/stats.controller';

const router = Router();

router.use(apiKeyAuth);

router.get('/usage', getUsageStats);
router.get('/summary', getSummary);
router.get('/audit-logs', getAuditLogs);
router.get('/top-metrics', getTopMetrics);

export default router;
