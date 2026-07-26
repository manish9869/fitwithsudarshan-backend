// src/routes/content.js (public)
import { Router } from 'express';
import { getPublicContentHandler } from '../controllers/contentController.js';

const router = Router();
router.get('/content/all', getPublicContentHandler);
export default router;