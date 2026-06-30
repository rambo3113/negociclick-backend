import { Router, Request, Response } from 'express';
import { register, login, getProfile, updateProfile, changePassword, getPendingCount, forgotPassword, resetPassword, sendVerificationEmail, verifyEmail } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../lib/upload';
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from '../lib/cloudinary';
import prisma from '../lib/prisma';
import { forgotPasswordLimiter } from '../middleware/rateLimit.middleware';
import { validate } from '../middleware/validate.middleware';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../lib/schemas';

const router = Router();

async function uploadAvatar(req: Request, res: Response) {
  try {
    const userId = (req as any).userId as string;
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    // Eliminar avatar anterior de Cloudinary si existe
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { avatar: true } });
    if (existing?.avatar && existing.avatar.includes('res.cloudinary.com')) {
      const oldPublicId = extractPublicId(existing.avatar);
      if (oldPublicId) await deleteFromCloudinary(oldPublicId).catch(() => {});
    }

    const { url } = await uploadToCloudinary(req.file.buffer);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar: url },
      select: { id: true, avatar: true },
    });
    res.json({ success: true, avatar: user.avatar });
  } catch {
    res.status(500).json({ error: 'Error al subir avatar' });
  }
}

router.post('/register',       validate(registerSchema), register);
router.post('/login',          validate(loginSchema), login);
router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.put('/password', authenticate, changePassword);
router.get('/pending-count', authenticate, getPendingCount);
router.post('/avatar', authenticate, upload.single('avatar'), uploadAvatar);
router.post('/send-verification', authenticate, sendVerificationEmail);
router.get('/verify-email', verifyEmail);

export default router;
