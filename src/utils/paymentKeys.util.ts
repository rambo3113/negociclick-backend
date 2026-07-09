import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const key = process.env.PAYMENT_KEYS_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('PAYMENT_KEYS_ENCRYPTION_KEY must be set as a 64-char hex string (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

// Output format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
export function encryptPaymentKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptPaymentKey(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Formato de llave cifrada inválido');
  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

// Devuelve true si sk es live (sk_live_*), false si es test (sk_test_*)
export function isLiveKey(key: string): boolean {
  return key.startsWith('sk_live_') || key.startsWith('pk_live_');
}

// Valida formato de pk/sk: prefijos reconocidos de Culqi
export function validateKeyFormat(pk: string, sk: string): string | null {
  if (!/^pk_(live|test)_/.test(pk)) return 'La clave pública debe comenzar con pk_live_ o pk_test_';
  if (!/^sk_(live|test)_/.test(sk)) return 'La clave secreta debe comenzar con sk_live_ o sk_test_';
  const pkLive = pk.startsWith('pk_live_');
  const skLive = sk.startsWith('sk_live_');
  if (pkLive !== skLive) return 'Las claves deben ser del mismo entorno (ambas live o ambas test)';
  return null;
}

// Llama a Culqi con la sk y devuelve true si es válida (200 OK), false si rechaza (401)
export async function validateCulqiSecretKey(sk: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.culqi.com/v2/charges?limit=1', {
      headers: { Authorization: `Bearer ${sk}` },
    });
    return res.status !== 401;
  } catch {
    throw new Error('No se pudo conectar a Culqi para verificar la clave');
  }
}

// Resuelve las llaves a usar para un cargo: primero intenta las del negocio (PREMIUM
// con llaves válidas), y cae en las de plataforma si no corresponde.
export async function resolveBusinessCulqiKeys(
  businessId: string,
  prisma: any,
): Promise<{ publicKey: string; secretKey: string; source: 'business' | 'platform' }> {
  const PLATFORM_SK = process.env.CULQI_SECRET_KEY!;
  const PLATFORM_PK = process.env.NEXT_PUBLIC_CULQI_PUBLIC_KEY ?? '';

  // Obtener plan del dueño del negocio
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      culqiPublicKey: true,
      culqiSecretKeyEnc: true,
      culqiKeysValidatedAt: true,
      owner: {
        select: {
          subscriptions: {
            where: { status: 'ACTIVE' },
            orderBy: { startDate: 'desc' },
            take: 1,
            select: { plan: true },
          },
        },
      },
    },
  });

  const plan = business?.owner?.subscriptions?.[0]?.plan ?? 'FREE';
  const hasValidKeys = !!(
    plan === 'PREMIUM' &&
    business?.culqiPublicKey &&
    business?.culqiSecretKeyEnc &&
    business?.culqiKeysValidatedAt
  );

  if (!hasValidKeys) {
    return { publicKey: PLATFORM_PK, secretKey: PLATFORM_SK, source: 'platform' };
  }

  const secretKey = decryptPaymentKey(business!.culqiSecretKeyEnc!);
  return { publicKey: business!.culqiPublicKey!, secretKey, source: 'business' };
}
