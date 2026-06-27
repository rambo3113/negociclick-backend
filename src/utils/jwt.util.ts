import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'FALLBACK_TEMPORAL_SOLO_PARA_DEBUG';
if (!process.env.JWT_SECRET) {
  console.warn('[WARN] JWT_SECRET no encontrado. Env keys:', Object.keys(process.env).filter(k => !k.includes('npm') && !k.includes('NODE')).join(', '));
}

export const generateToken = (payload: { userId: string; email: string; role: string }) => {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: '7d' });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET!);
};