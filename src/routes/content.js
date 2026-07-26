// src/routes/content.js (public)
import { Router } from 'express';
import { getPublicContentHandler, getContentVersionHandler } from '../controllers/contentController.js';

const router = Router();
router.get('/content/all', getPublicContentHandler);
router.get('/content/version', getContentVersionHandler);
export default router;