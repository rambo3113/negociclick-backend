import { Router } from 'express';
import {
  createSubcategory,
  getSubcategories,
  updateSubcategory,
  deleteSubcategory,
} from '../controllers/subcategory.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router({ mergeParams: true });

router.get('/',        getSubcategories);
router.post('/',       authenticate, createSubcategory);
router.put('/:subId',  authenticate, updateSubcategory);
router.delete('/:subId', authenticate, deleteSubcategory);

export default router;
