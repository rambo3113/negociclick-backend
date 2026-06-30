import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET no está definido.');
  process.exit(1);
}

export const generateAccessToken = (payload: { userId: string; email: string; role: string }) => {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: '15m' });
};

export const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET!);
};

// Backwards-compat alias used by older imports
export const generateToken = generateAccessToken;
