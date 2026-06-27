import { Router } from 'express';
import { getPhotos, uploadPhoto, deletePhoto } from '../controllers/photos.controller';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../lib/upload';

const router = Router({ mergeParams: true }); // hereda :id de businesses

router.get('/', getPhotos);
router.post('/', authenticate, upload.single('photo'), uploadPhoto);
router.delete('/:photoId', authenticate, deletePhoto);

export default router;
