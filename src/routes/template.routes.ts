import { Router } from 'express';
import {
  listPublicTemplates,
  getPublicTemplate,
  getPublicTemplateByCode,
} from '../controllers/template.controller';

const router = Router();

router.get('/', listPublicTemplates);
router.get('/code/:code', getPublicTemplateByCode);
router.get('/:id', getPublicTemplate);

export default router;
