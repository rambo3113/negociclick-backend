import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET no está definido en las variables de entorno');
  console.error('Variables disponibles:', Object.keys(process.env).join(', '));
  process.exit(1);
}

export const generateToken = (payload: { userId: string; email: string; role: string }) => {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: '7d' });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET!);
};