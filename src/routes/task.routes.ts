import { Router } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import {
  createTask,
  listTasks,
  getTask,
  getTaskProgress,
  cancelTaskHandler as cancelTask,
  retryTask,
  deleteTask,
} from '../controllers/task.controller';

const router = Router();

router.use(apiKeyAuth);

router.post('/', createTask);
router.get('/', listTasks);
router.get('/:id', getTask);
router.get('/:id/progress', getTaskProgress);
router.post('/:id/cancel', cancelTask);
router.post('/:id/retry', retryTask);
router.delete('/:id', deleteTask);

export default router;
