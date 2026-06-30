import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM ?? 'NegociClick <onboarding@resend.dev>';

function base(content: string) {
  return `
  <!DOCTYPE html>
  <html lang="es">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#6366f1,#a855f7);padding:28px 32px;text-align:center;">
        <p style="margin:0;font-size:24px;font-weight:900;font-family:Arial,Helvetica,sans-serif;letter-spacing:-0.5px;">
          ⚡ <span style="color:#ffffff;">Negoci</span><span style="color:#c7d2fe;">Click</span>
        </p>
      </div>
      <!-- Body -->
      <div style="padding:32px;">
        ${content}
      </div>
      <!-- Footer -->
      <div style="background:#f1f5f9;padding:16px 32px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">
          © 2026 NegociClick · Lima, Perú<br/>
          WhatsApp: <a href="https://wa.me/51983081196" style="color:#94a3b8;">+51 983 081 196</a><br/>
          Este correo fue enviado automáticamente, por favor no respondas directamente.
        </p>
      </div>
    </div>
  </body>
  </html>`;
}

async function send(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) return;
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) console.error('[email]', error);
}

// ── 1. Reserva creada → vendor ──────────────────────────────────────────────
export async function sendBookingCreatedToVendor(opts: {
  vendorEmail: string;
  vendorName: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  date: Date;
  amount: number;
}) {
  const dateStr = opts.date.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  await send(opts.vendorEmail, `Nueva reserva — ${opts.serviceName}`, base(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;">📅 Nueva reserva recibida</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Tienes una nueva reserva en <strong>${opts.businessName}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;width:40%;">Cliente</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.clientName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Servicio</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.serviceName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Fecha</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${dateStr}</td></tr>
      <tr><td style="padding:10px 0;color:#64748b;">Monto</td><td style="padding:10px 0;color:#6366f1;font-weight:800;font-size:18px;">S/ ${opts.amount.toFixed(2)}</td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">Revisa el estado de esta reserva en tu dashboard de NegociClick.</p>
  `));
}

// ── 2. Pago confirmado → cliente ────────────────────────────────────────────
export async function sendBookingConfirmedToClient(opts: {
  clientEmail: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  businessPhone: string;
  date: Date;
  amount: number;
}) {
  const dateStr = opts.date.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  await send(opts.clientEmail, `¡Reserva confirmada! — ${opts.serviceName}`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#dcfce7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">✅</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;text-align:center;">¡Tu reserva está confirmada!</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;text-align:center;">Hola <strong>${opts.clientName}</strong>, tu pago fue procesado exitosamente.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;width:40%;">Negocio</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.businessName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Servicio</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.serviceName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Fecha</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${dateStr}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">WhatsApp</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;"><a href="https://wa.me/51${opts.businessPhone.replace(/\D/g,'')}" style="color:#22c55e;font-weight:600;">${opts.businessPhone}</a></td></tr>
      <tr><td style="padding:10px 0;color:#64748b;">Pagado</td><td style="padding:10px 0;color:#6366f1;font-weight:800;font-size:18px;">S/ ${opts.amount.toFixed(2)}</td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;text-align:center;">¡Te esperamos! Si necesitas cambios contáctanos por WhatsApp.</p>
  `));
}

// ── 3. Pago recibido → vendor ───────────────────────────────────────────────
export async function sendPaymentReceivedToVendor(opts: {
  vendorEmail: string;
  vendorName: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  date: Date;
  amount: number;
  vendorAmount: number;
  commission: number;
}) {
  const dateStr = opts.date.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  await send(opts.vendorEmail, `💰 Pago recibido — ${opts.serviceName}`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#dcfce7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">💰</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;text-align:center;">¡Pago recibido!</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;text-align:center;">Se acaba de procesar un pago online en <strong>${opts.businessName}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;width:40%;">Cliente</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.clientName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Servicio</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.serviceName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Fecha cita</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${dateStr}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Total cobrado</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:700;">S/ ${opts.amount.toFixed(2)}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Comisión NegociClick</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#ef4444;font-weight:600;">− S/ ${opts.commission.toFixed(2)}</td></tr>
      <tr><td style="padding:10px 0;color:#64748b;">Tu ganancia neta</td><td style="padding:10px 0;color:#22c55e;font-weight:800;font-size:18px;">S/ ${opts.vendorAmount.toFixed(2)}</td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;text-align:center;">Revisa tu dashboard para gestionar esta reserva.</p>
  `));
}

// ── 4. Recordatorio de reseña → cliente ─────────────────────────────────────
export async function sendReviewReminderToClient(opts: {
  clientEmail: string;
  clientName: string;
  serviceName: string;
  businessName: string;
}) {
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  await send(opts.clientEmail, `¿Cómo estuvo tu cita en ${opts.businessName}?`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#fef3c7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">⭐</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;text-align:center;">¿Cómo te fue?</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:14px;text-align:center;">
      Hola <strong>${opts.clientName}</strong>, tu cita de <strong>${opts.serviceName}</strong> en <strong>${opts.businessName}</strong> fue completada.
    </p>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;text-align:center;">
      Tu opinión ayuda a otros clientes a elegir mejor. ¡Solo toma 30 segundos!
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${appUrl}/bookings"
         style="display:inline-block;background-color:#6366f1;background:linear-gradient(135deg,#6366f1,#a855f7);color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
        Dejar mi reseña ⭐
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">Si ya dejaste tu reseña, ignora este correo.</p>
  `));
}

// ── 5. Recuperación de contraseña ───────────────────────────────────────────
export async function sendPasswordResetEmail(opts: {
  email: string;
  name: string;
  resetUrl: string;
}) {
  await send(opts.email, 'Recupera tu contraseña — NegociClick', base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#ede9fe;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">🔐</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;text-align:center;">Recupera tu contraseña</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:14px;text-align:center;">
      Hola <strong>${opts.name}</strong>, recibimos una solicitud para restablecer la contraseña de tu cuenta NegociClick.
    </p>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;text-align:center;">
      Haz clic en el botón de abajo. El enlace es válido por <strong>30 minutos</strong>.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${opts.resetUrl}"
         style="display:inline-block;background-color:#6366f1;background:linear-gradient(135deg,#6366f1,#a855f7);color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
        Restablecer contraseña
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
      Si no solicitaste este cambio, ignora este correo. Tu contraseña no cambiará.
    </p>
  `));
}

// ── 6. Recordatorio 24h antes de la cita → cliente ──────────────────────────
export async function sendAppointmentReminder(opts: {
  clientEmail: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  businessPhone: string;
  date: Date;
}) {
  const dateStr = opts.date.toLocaleDateString('es-PE', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  await send(opts.clientEmail, '⏰ Recordatorio — tu cita es mañana', base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#dbeafe;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">⏰</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;text-align:center;">¡Tu cita es mañana!</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;text-align:center;">
      Hola <strong>${opts.clientName}</strong>, te recordamos que tienes una cita programada.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;width:40%;">Negocio</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.businessName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Servicio</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.serviceName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Fecha</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${dateStr}</td></tr>
      <tr><td style="padding:10px 0;color:#64748b;">Contacto</td><td style="padding:10px 0;"><a href="https://wa.me/51${opts.businessPhone.replace(/\D/g,'')}" style="color:#22c55e;font-weight:600;">${opts.businessPhone}</a></td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;text-align:center;">Si necesitas reagendar, contáctanos por WhatsApp.</p>
  `));
}

// ── 7. Verificación de email ─────────────────────────────────────────────────
export async function sendEmailVerification(opts: {
  email: string;
  name: string;
  verifyUrl: string;
}) {
  await send(opts.email, 'Verifica tu correo — NegociClick', base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#dcfce7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">✉️</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;text-align:center;">Verifica tu correo</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:14px;text-align:center;">
      Hola <strong>${opts.name}</strong>, haz clic en el botón para verificar tu correo electrónico.
    </p>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;text-align:center;">
      El enlace es válido por <strong>24 horas</strong>.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${opts.verifyUrl}"
         style="display:inline-block;background-color:#22c55e;background:linear-gradient(135deg,#22c55e,#16a34a);color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
        Verificar mi correo
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
      Si no creaste esta cuenta, ignora este correo.
    </p>
  `));
}

// ── 8. Suscripción activada → vendor ────────────────────────────────────────
export async function sendSubscriptionConfirmed(opts: {
  email: string;
  name: string;
  plan: string;
  price: number;
}) {
  const planEmoji: Record<string, string> = { FREE: '🆓', PRO: '⚡', PREMIUM: '👑' };
  const emoji = planEmoji[opts.plan] ?? '✅';
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  await send(opts.email, `${emoji} Plan ${opts.plan} activado — NegociClick`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#ede9fe;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">${emoji}</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;text-align:center;">¡Plan ${opts.plan} activado!</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;text-align:center;">
      Hola <strong>${opts.name}</strong>, tu suscripción al plan <strong>${opts.plan}</strong> fue activada exitosamente.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;width:40%;">Plan</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:700;">${opts.plan}</td></tr>
      <tr><td style="padding:10px 0;color:#64748b;">Monto cobrado</td><td style="padding:10px 0;color:#6366f1;font-weight:800;font-size:18px;">${opts.price === 0 ? 'Gratis' : `S/ ${opts.price.toFixed(2)}`}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${appUrl}/dashboard"
         style="display:inline-block;background-color:#6366f1;background:linear-gradient(135deg,#6366f1,#a855f7);color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
        Ir a mi dashboard
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">Si no realizaste esta acción, contáctanos de inmediato.</p>
  `));
}

// ── 9. Aviso de vencimiento próximo (7, 3 o 1 día antes) → vendor ──────────
export async function sendSubscriptionExpiring(opts: {
  email: string;
  name: string;
  plan: string;
  endDate: Date;
  daysLeft: number;
}) {
  const planEmoji: Record<string, string> = { PRO: '⚡', PREMIUM: '👑' };
  const emoji = planEmoji[opts.plan] ?? '⚡';
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const endStr = opts.endDate.toLocaleDateString('es-PE', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
  const urgency = opts.daysLeft === 1
    ? { icon: '🚨', bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', label: '¡Último aviso!' }
    : { icon: '⏳', bg: '#fef9c3', border: '#fde047', text: '#854d0e', label: 'Aviso de vencimiento' };

  await send(opts.email, `${emoji} Tu plan ${opts.plan} vence en ${opts.daysLeft} día${opts.daysLeft !== 1 ? 's' : ''} — NegociClick`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#fef3c7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">${urgency.icon}</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;text-align:center;">${urgency.label}: tu plan ${opts.plan} vence pronto</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;text-align:center;">
      Hola <strong>${opts.name}</strong>, tu suscripción al plan <strong>${opts.plan}</strong>
      vence el <strong>${endStr}</strong> (en <strong>${opts.daysLeft} día${opts.daysLeft !== 1 ? 's' : ''}</strong>).
    </p>
    <div style="background:${urgency.bg};border:1px solid ${urgency.border};border-radius:12px;padding:16px;margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:14px;color:${urgency.text};">
        ⚠️ Si no renuevas, tu cuenta volverá al <strong>plan FREE</strong> automáticamente
        y solo podrás tener hasta 5 servicios activos. Los servicios adicionales se ocultarán temporalmente.
      </p>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${appUrl}/subscription"
         style="display:inline-block;background-color:#6366f1;background:linear-gradient(135deg,#6366f1,#a855f7);color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
        Renovar mi plan ahora
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
      ¿Tienes dudas? Escríbenos a <a href="mailto:noreply@negociclick.com" style="color:#6366f1;">noreply@negociclick.com</a>
    </p>
  `));
}

// ── 10. Suscripción vencida → plan degradado a FREE → vendor ────────────────
export async function sendSubscriptionExpired(opts: {
  email: string;
  name: string;
  plan: string;
}) {
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  await send(opts.email, `Tu plan ${opts.plan} ha vencido — NegociClick`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#fee2e2;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">😔</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;text-align:center;">Tu plan ${opts.plan} ha vencido</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:14px;text-align:center;">
      Hola <strong>${opts.name}</strong>, tu suscripción al plan <strong>${opts.plan}</strong> ha expirado
      y tu cuenta ha sido movida al <strong>plan FREE</strong>.
    </p>
    <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:13px;color:#475569;font-weight:600;">¿Qué significa esto?</p>
      <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.8;">
        <li>Tu negocio permanece visible en NegociClick</li>
        <li>Solo puedes tener hasta <strong>5 servicios activos</strong></li>
        <li>Los servicios adicionales fueron ocultados temporalmente (no eliminados)</li>
        <li>Al renovar, todos tus servicios se reactivarán automáticamente</li>
      </ul>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${appUrl}/subscription"
         style="display:inline-block;background-color:#6366f1;background:linear-gradient(135deg,#6366f1,#a855f7);color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">
        Reactivar mi plan
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
      ¿Necesitas ayuda? Escríbenos a <a href="mailto:noreply@negociclick.com" style="color:#6366f1;">noreply@negociclick.com</a>
    </p>
  `));
}

// ── 11. Reserva cancelada → cliente ─────────────────────────────────────────
export async function sendBookingCancelledToClient(opts: {
  clientEmail: string;
  clientName: string;
  serviceName: string;
  businessName: string;
}) {
  await send(opts.clientEmail, `Reserva cancelada — ${opts.serviceName}`, base(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;">Reserva cancelada</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hola <strong>${opts.clientName}</strong>, tu reserva de <strong>${opts.serviceName}</strong> en <strong>${opts.businessName}</strong> ha sido cancelada.</p>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Si tienes dudas o quieres reagendar, visita NegociClick o contáctanos.</p>
  `));
}

// ── 12. Reserva cancelada por cliente → vendor ──────────────────────────────
export async function sendBookingCancelledToVendor(opts: {
  vendorEmail: string;
  vendorName: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  date: Date;
}) {
  const dateStr = opts.date.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  await send(opts.vendorEmail, `Reserva cancelada — ${opts.serviceName}`, base(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;">Reserva cancelada por el cliente</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;">El cliente <strong>${opts.clientName}</strong> canceló su reserva en <strong>${opts.businessName}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;width:40%;">Servicio</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.serviceName}</td></tr>
      <tr><td style="padding:10px 0;color:#64748b;">Fecha cancelada</td><td style="padding:10px 0;color:#94a3b8;text-decoration:line-through;">${dateStr}</td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">El horario quedó libre. Puedes gestionarlo desde tu dashboard.</p>
  `));
}

// ── 14. Destacado vence pronto → vendor ─────────────────────────────────────
export async function sendFeaturedExpiring(opts: {
  email: string;
  name: string;
  businessName: string;
  featuredUntil: Date;
  daysLeft: number;
}) {
  const dateStr = opts.featuredUntil.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
  await send(opts.email, `Tu Negocio Destacado vence en ${opts.daysLeft} día${opts.daysLeft !== 1 ? 's' : ''} — ${opts.businessName}`, base(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;">⭐ Tu destacado vence pronto</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;">
      Hola <strong>${opts.name}</strong>, tu negocio <strong>${opts.businessName}</strong> dejará de aparecer
      destacado en <strong>${opts.daysLeft} día${opts.daysLeft !== 1 ? 's' : ''}</strong> (${dateStr}).
    </p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#92400e;">
        ⏰ Renueva ahora para seguir apareciendo primero en los resultados y con badge dorado.
      </p>
    </div>
    <a href="https://www.negociclick.com/dashboard" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#f97316);color:#ffffff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;">
      Renovar Destacado →
    </a>
    <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">Si ya no quieres renovar, tu negocio seguirá activo pero sin la posición destacada.</p>
  `));
}

// ── 15. Destacado expirado → vendor ─────────────────────────────────────────
export async function sendFeaturedExpired(opts: {
  email: string;
  name: string;
  businessName: string;
}) {
  await send(opts.email, `Tu Negocio Destacado expiró — ${opts.businessName}`, base(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;">Tu período destacado terminó</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;">
      Hola <strong>${opts.name}</strong>, el período de <strong>${opts.businessName}</strong> como
      Negocio Destacado ha vencido. Tu negocio sigue activo, pero ya no aparecerá primero ni con el badge dorado.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:14px;color:#1e293b;font-weight:600;">¿Quieres volver a destacarte?</p>
      <p style="margin:0;font-size:14px;color:#64748b;">
        Desde S/ 19.90 por 7 días · S/ 34.90 por 15 días · S/ 59.90 por 30 días
      </p>
    </div>
    <a href="https://www.negociclick.com/dashboard" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);color:#ffffff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;">
      Volver a Destacar →
    </a>
    <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">Tu negocio seguirá recibiendo reservas normalmente.</p>
  `));
}

// ── 13. Reserva reagendada → vendor ─────────────────────────────────────────
export async function sendBookingRescheduledToVendor(opts: {
  vendorEmail: string;
  vendorName: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  oldDate: Date;
  newDate: Date;
}) {
  const fmt = (d: Date) => d.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  await send(opts.vendorEmail, `Reserva reagendada — ${opts.serviceName}`, base(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1e293b;">🔄 Reserva reagendada</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;">El cliente <strong>${opts.clientName}</strong> cambió el horario de su reserva en <strong>${opts.businessName}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;width:40%;">Servicio</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-weight:600;">${opts.serviceName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;">Antes</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#94a3b8;text-decoration:line-through;">${fmt(opts.oldDate)}</td></tr>
      <tr><td style="padding:10px 0;color:#64748b;">Nuevo horario</td><td style="padding:10px 0;color:#6366f1;font-weight:700;">${fmt(opts.newDate)}</td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">Revisa tu agenda en el dashboard de NegociClick.</p>
  `));
}
