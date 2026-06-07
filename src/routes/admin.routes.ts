import { Router } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
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

router.get('/templates', listTemplates);
router.get('/templates/code/:code', getTemplateByCode);
router.get('/templates/:id', getTemplate);

router.post('/feedback', apiKeyAuth, submitFeedback);

router.get('/api-keys', listApiKeys);
router.post('/api-keys', createApiKey);
router.get('/api-keys/:id', getApiKey);
router.put('/api-keys/:id', updateApiKey);
router.delete('/api-keys/:id', deleteApiKey);
router.post('/api-keys/:id/quota', updateQuota);
router.post('/api-keys/:id/reset-quota', resetQuota);

router.post('/templates', createTemplate);
router.put('/templates/:id', updateTemplate);
router.delete('/templates/:id', deleteTemplate);

router.get('/feedback', listFeedbacks);

router.get('/errors', listErrors);
router.get('/errors/stats', getErrorStats);
router.get('/errors/:id', getErrorDetail);

export default router;
