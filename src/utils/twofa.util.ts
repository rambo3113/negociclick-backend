import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import crypto from 'crypto';

export function generateTOTPSecret(email: string) {
  return speakeasy.generateSecret({
    name: `NegociClick (${email})`,
    issuer: 'NegociClick',
    length: 32,
  });
}

export async function generateQRCode(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

export function generateBackupCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  );
}

export function verifyTOTPToken(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 2,
  });
}
