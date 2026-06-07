import { Router } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import {
  createSession,
  sendMessage,
  listSessions,
  getSession,
  getSessionMessages,
  updateSession,
  deleteSession,
} from '../controllers/session.controller';

const router = Router();

router.use(apiKeyAuth);

router.post('/', createSession);
router.post('/message', sendMessage);
router.get('/', listSessions);
router.get('/:sessionId', getSession);
router.get('/:sessionId/messages', getSessionMessages);
router.put('/:sessionId', updateSession);
router.delete('/:sessionId', deleteSession);

export default router;
