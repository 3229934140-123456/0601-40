import { Router } from 'express';
import multer from 'multer';
import { apiKeyAuth } from '../middleware/auth.middleware';
import {
  uploadDocument,
  listDocuments,
  getDocument,
  getDocumentContent,
  updateDocument,
  deleteDocument,
} from '../controllers/document.controller';

const router = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'),
  },
});

router.use(apiKeyAuth);

router.post('/upload', upload.single('file'), uploadDocument);
router.get('/', listDocuments);
router.get('/:id', getDocument);
router.get('/:id/content', getDocumentContent);
router.put('/:id', updateDocument);
router.delete('/:id', deleteDocument);

export default router;
