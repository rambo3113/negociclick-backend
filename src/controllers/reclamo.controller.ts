import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const FROM = `"NegociClick" <${process.env.SMTP_USER}>`;

export const createReclamo = async (req: Request, res: Response) => {
  try {
    const {
      nombre, apellido, dni, email, telefono,
      tipoDocumento, tipoReclamo, // RECLAMO | QUEJA
      descripcion, pedido,
    } = req.body as {
      nombre: string; apellido: string; dni: string; email: string;
      telefono?: string; tipoDocumento?: string;
      tipoReclamo: string; descripcion: string; pedido?: string;
    };

    if (!nombre?.trim() || !apellido?.trim() || !dni?.trim() || !email?.trim() || !descripcion?.trim() || !tipoReclamo) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    if (!['RECLAMO', 'QUEJA'].includes(tipoReclamo)) {
      return res.status(400).json({ error: 'Tipo de reclamo inválido' });
    }

    const numero = `SC-${Date.now()}`;
    const fechaStr = new Date().toLocaleDateString('es-PE', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    // Notificar al equipo NegociClick
    if (process.env.SMTP_USER) {
      await transporter.sendMail({
        from: FROM,
        to: process.env.SMTP_USER,
        subject: `[${tipoReclamo}] ${numero} — ${nombre} ${apellido}`,
        html: `
          <h2>Nuevo ${tipoReclamo.toLowerCase()} recibido</h2>
          <table style="border-collapse:collapse;font-size:14px;width:100%">
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Número</td><td style="padding:6px 12px;">${numero}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Fecha</td><td style="padding:6px 12px;">${fechaStr}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Nombre</td><td style="padding:6px 12px;">${nombre} ${apellido}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Doc.</td><td style="padding:6px 12px;">${tipoDocumento ?? 'DNI'}: ${dni}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Email</td><td style="padding:6px 12px;">${email}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Teléfono</td><td style="padding:6px 12px;">${telefono ?? '—'}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Tipo</td><td style="padding:6px 12px;">${tipoReclamo}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Descripción</td><td style="padding:6px 12px;">${descripcion}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Pedido</td><td style="padding:6px 12px;">${pedido ?? '—'}</td></tr>
          </table>
        `,
      }).catch(() => {});

      // Confirmación al consumidor
      await transporter.sendMail({
        from: FROM,
        to: email,
        subject: `Recibimos tu ${tipoReclamo.toLowerCase()} — ${numero}`,
        html: `
          <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
          <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
            <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
              <div style="background:linear-gradient(135deg,#6366f1,#a855f7);padding:28px 32px;text-align:center;">
                <h1 style="margin:0;color:#fff;font-size:22px;font-weight:900;">⚡ NegociClick</h1>
              </div>
              <div style="padding:32px;">
                <h2 style="margin:0 0 8px;color:#1e293b;">Hemos recibido tu ${tipoReclamo.toLowerCase()}</h2>
                <p style="color:#64748b;font-size:14px;">Hola <strong>${nombre}</strong>, tu ${tipoReclamo.toLowerCase()} fue registrado correctamente.</p>
                <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin:20px 0;">
                  <p style="margin:0 0 4px;font-size:13px;color:#475569;font-weight:600;">Número de expediente</p>
                  <p style="margin:0;font-size:22px;font-weight:900;color:#6366f1;">${numero}</p>
                </div>
                <p style="color:#64748b;font-size:14px;">Plazo de respuesta: <strong>hasta 30 días hábiles</strong> según la normativa del INDECOPI.</p>
                <p style="color:#64748b;font-size:13px;margin-top:16px;">Si tienes alguna consulta adicional, escríbenos a <a href="mailto:negociclick2026@gmail.com" style="color:#6366f1;">negociclick2026@gmail.com</a></p>
              </div>
              <div style="background:#f1f5f9;padding:16px 32px;text-align:center;">
                <p style="margin:0;font-size:12px;color:#94a3b8;">© 2026 NegociClick · Lima, Perú</p>
              </div>
            </div>
          </body></html>
        `,
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      numero,
      message: `Tu ${tipoReclamo.toLowerCase()} fue registrado. Número de expediente: ${numero}`,
    });

  } catch (error) {
    console.error('Error al registrar reclamo:', error);
    res.status(500).json({ error: 'Error al registrar el reclamo' });
  }
};
