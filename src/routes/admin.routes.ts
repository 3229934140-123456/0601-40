import { Router } from 'express';
import { apiKeyAuth, adminAuth } from '../middleware/auth.middleware';
import {
  createApiKey,
  listApiKeys,
  getApiKey,
  updateApiKey,
  deleteApiKey,
  updateQuota,
  resetQuota,
  createTemplate,
  listTemplates,
  getTemplate,
  getTemplateByCode,
  updateTemplate,
  deleteTemplate,
  submitFeedback,
  listFeedbacks,
  listErrors,
  getErrorStats,
  getErrorDetail,
  listAuditLogs,
  getAuditLogDetail,
} from '../controllers/admin.controller';

const router = Router();

// 业务接口 - 需要业务 API Key
router.post('/feedback', apiKeyAuth, submitFeedback);

// 管理员接口 - 需要管理员令牌
router.use('/api-keys', adminAuth);
router.get('/api-keys', listApiKeys);
router.post('/api-keys', createApiKey);
router.get('/api-keys/:id', getApiKey);
router.put('/api-keys/:id', updateApiKey);
router.delete('/api-keys/:id', deleteApiKey);
router.post('/api-keys/:id/quota', updateQuota);
router.post('/api-keys/:id/reset-quota', resetQuota);

router.use('/templates', adminAuth);
router.get('/templates', listTemplates);
router.post('/templates', createTemplate);
router.get('/templates/code/:code', getTemplateByCode);
router.get('/templates/:id', getTemplate);
router.put('/templates/:id', updateTemplate);
router.delete('/templates/:id', deleteTemplate);

router.get('/feedback', adminAuth, listFeedbacks);

router.get('/errors', adminAuth, listErrors);
router.get('/errors/stats', adminAuth, getErrorStats);
router.get('/errors/:id', adminAuth, getErrorDetail);

router.get('/audit-logs', adminAuth, listAuditLogs);
router.get('/audit-logs/:id', adminAuth, getAuditLogDetail);

export default router;
