import { Request, Response, NextFunction } from 'express';

// Culqi no firma sus webhooks con clave pública, así que verificamos con un
// secreto embebido en la propia URL: /api/payments/webhook/:secret
// Configura esa misma URL completa (con el secreto) en el panel de Culqi.
// Quien no conozca el secreto ni siquiera llega a que se procese el payload.
export function verifyCulqiWebhook(req: Request, res: Response, next: NextFunction) {
  const expectedSecret = process.env.CULQI_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('[webhook] CULQI_WEBHOOK_SECRET no configurado en el servidor');
    return res.status(500).json({ error: 'Webhook no configurado en el servidor' });
  }

  const receivedSecret = req.params.secret;
  if (!receivedSecret || receivedSecret !== expectedSecret) {
    console.warn('[webhook] Secreto de URL inválido o ausente');
    return res.status(401).json({ error: 'No autorizado' });
  }

  next();
}
