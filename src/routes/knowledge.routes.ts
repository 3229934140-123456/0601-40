import { Router } from 'express';
import { apiKeyAuth } from '../middleware/auth.middleware';
import {
  createKnowledgeBase,
  listKnowledgeBases,
  getKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  addEntry,
  batchAddEntries,
  listEntries,
  updateEntry,
  deleteEntry,
  listEntryVersions,
  getEntryVersion,
  searchKnowledge,
  askQuestion,
} from '../controllers/knowledge.controller';

const router = Router();

router.use(apiKeyAuth);

router.get('/', listKnowledgeBases);
router.post('/', createKnowledgeBase);
router.get('/:id', getKnowledgeBase);
router.put('/:id', updateKnowledgeBase);
router.delete('/:id', deleteKnowledgeBase);

router.get('/:id/entries', listEntries);
router.post('/:id/entries', addEntry);
router.post('/:id/entries/batch', batchAddEntries);
router.put('/:id/entries/:entryId', updateEntry);
router.delete('/:id/entries/:entryId', deleteEntry);
router.get('/:id/entries/:entryId/versions', listEntryVersions);
router.get('/:id/entries/:entryId/versions/:version', getEntryVersion);

router.get('/:id/search', searchKnowledge);
router.post('/:id/ask', askQuestion);

export default router;
