import { Request, Response, NextFunction } from 'express';

// Culqi no firma webhooks con clave pública.
// Verificamos con un token secreto en la URL: /api/payments/webhook?token=CULQI_WEBHOOK_TOKEN
// Si alguien no conoce el token, el endpoint rechaza la petición antes de procesarla.
export function verifyCulqiWebhook(req: Request, res: Response, next: NextFunction) {
  const expectedToken = process.env.CULQI_WEBHOOK_TOKEN;
  if (!expectedToken) {
    console.error('[webhook] CULQI_WEBHOOK_TOKEN no configurado');
    return res.status(500).json({ error: 'Webhook no configurado en el servidor' });
  }

  const receivedToken = req.query.token as string | undefined;
  if (!receivedToken || receivedToken !== expectedToken) {
    console.warn('[webhook] Token inválido o ausente');
    return res.status(401).json({ error: 'No autorizado' });
  }

  next();
}
