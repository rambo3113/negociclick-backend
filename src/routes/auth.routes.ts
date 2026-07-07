import { Router, Request, Response } from 'express';
import { register, login, getProfile, updateProfile, changePassword, getPendingCount, forgotPassword, resetPassword, sendVerificationEmail, verifyEmail, refreshAccessToken, logout, deleteAccount } from '../controllers/auth.controller';
import { setup2FA, enable2FA, verifyLogin2FA, disable2FA, get2FAStatus, regenerateBackupCodes } from '../controllers/twofa.controller';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../lib/upload';
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from '../lib/cloudinary';
import prisma from '../lib/prisma';
import { forgotPasswordLimiter, resendVerificationLimiter } from '../middleware/rateLimit.middleware';
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
router.post('/send-verification', authenticate, resendVerificationLimiter, sendVerificationEmail);
router.get('/verify-email', verifyEmail);
router.post('/refresh', refreshAccessToken);
router.post('/logout', logout);
router.delete('/account', authenticate, deleteAccount);

// 2FA
router.get('/2fa/status',                   authenticate, get2FAStatus);
router.post('/2fa/setup',                   authenticate, setup2FA);
router.post('/2fa/enable',                  authenticate, enable2FA);
router.post('/2fa/verify-login',            verifyLogin2FA);
router.post('/2fa/disable',                 authenticate, disable2FA);
router.post('/2fa/regenerate-backup-codes', authenticate, regenerateBackupCodes);

export default router;
