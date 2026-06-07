import { Router } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import {
  checkText,
  addSensitiveWord,
  listSensitiveWords,
  updateSensitiveWord,
  deleteSensitiveWord,
  getCategories,
  batchAddWords,
} from '../controllers/audit.controller';

const router = Router();

router.post('/check', apiKeyAuth, checkText);

router.get('/words', apiKeyAuth, listSensitiveWords);
router.post('/words', apiKeyAuth, addSensitiveWord);
router.put('/words/:id', apiKeyAuth, updateSensitiveWord);
router.delete('/words/:id', apiKeyAuth, deleteSensitiveWord);
router.post('/words/batch', apiKeyAuth, batchAddWords);
router.get('/categories', apiKeyAuth, getCategories);

export default router;
