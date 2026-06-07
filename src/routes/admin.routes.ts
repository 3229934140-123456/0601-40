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
} from '../controllers/admin.controller';

const router = Router();

// 公开接口 - 模板只读
router.get('/templates', listTemplates);
router.get('/templates/code/:code', getTemplateByCode);
router.get('/templates/:id', getTemplate);

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

router.post('/templates', adminAuth, createTemplate);
router.put('/templates/:id', adminAuth, updateTemplate);
router.delete('/templates/:id', adminAuth, deleteTemplate);

router.get('/feedback', adminAuth, listFeedbacks);

router.get('/errors', adminAuth, listErrors);
router.get('/errors/stats', adminAuth, getErrorStats);
router.get('/errors/:id', adminAuth, getErrorDetail);

export default router;
