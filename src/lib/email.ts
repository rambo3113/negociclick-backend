import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM ?? 'NegociClick <notificaciones@negociclick.com>';
const APP_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

type OrderMode = 'APPOINTMENT' | 'ORDER';

// ── Parser de pedidos: misma fuente que el dashboard (notes con formato [PEDIDO]) ──
interface EmailOrderItem { qty: number; name: string; subtotal: string }
interface EmailParsedOrder { items: EmailOrderItem[]; total: string | null; address: string | null; extraNotes: string | null }

function parseOrderNotes(notes?: string | null): EmailParsedOrder {
  if (!notes?.startsWith('[PEDIDO]')) return { items: [], total: null, address: null, extraNotes: null };
  const body = notes.slice('[PEDIDO] '.length);
  const parts = body.split(' | ');
  const itemsPart = parts[0] ?? '';
  const total = (parts.find(p => p.startsWith('Total:')) ?? '').slice('Total: '.length) || null;
  const address = (parts.find(p => p.startsWith('Dirección:')) ?? '').slice('Dirección: '.length) || null;
  const extraNotes = (parts.find(p => p.startsWith('Notas:')) ?? '').slice('Notas: '.length) || null;
  const items: EmailOrderItem[] = itemsPart.split(' + ').map(chunk => {
    const m = chunk.match(/^(\d+)x (.+) \(S\/ ([\d.,]+)\)$/);
    if (!m) return null;
    return { qty: parseInt(m[1]), name: m[2], subtotal: `S/ ${m[3]}` };
  }).filter((x): x is EmailOrderItem => x !== null);
  return { items, total, address, extraNotes };
}

const dateOnly = (d: Date) => d.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const dateTime = (d: Date) => d.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ── Bloques de plantilla (tablas + estilos inline, compatibles con Gmail/Outlook) ──
function base(content: string) {
  return `
  <!DOCTYPE html>
  <html lang="es">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background-color:#F9FAFB;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background-color:#4F46E5;background-image:linear-gradient(to right,#4F46E5,#9333EA);padding:28px 32px;text-align:center;">
                <span style="font-size:22px;font-weight:900;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">⚡ NegociClick</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${content}
              </td>
            </tr>
            <tr>
              <td style="background-color:#F3F4F6;padding:16px 32px;text-align:center;">
                <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.7;">
                  © 2026 NegociClick · Lima, Perú<br/>
                  WhatsApp: <a href="https://wa.me/51983081196" style="color:#9CA3AF;">+51 983 081 196</a><br/>
                  Este correo fue enviado automáticamente, por favor no respondas directamente.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}

function heading(title: string, subtitle?: string) {
  return `
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;font-family:Arial,Helvetica,sans-serif;">${title}</h2>
    ${subtitle ? `<p style="margin:0 0 24px;color:#6B7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">${subtitle}</p>` : ''}
  `;
}

function dataTable(rows: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">${rows}</table>`;
}

function dataRow(label: string, value: string, opts: { last?: boolean; valueColor?: string; big?: boolean } = {}) {
  const border = opts.last ? '' : 'border-bottom:1px solid #F3F4F6;';
  const color = opts.valueColor ?? '#111827';
  const size = opts.big ? '18px' : '14px';
  const weight = opts.big ? '800' : '600';
  return `<tr>
    <td style="padding:10px 0;${border}color:#6B7280;font-size:14px;width:40%;vertical-align:top;">${label}</td>
    <td style="padding:10px 0;${border}color:${color};font-weight:${weight};font-size:${size};">${value}</td>
  </tr>`;
}

function itemsTable(items: EmailOrderItem[]) {
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #F3F4F6;color:#111827;font-size:14px;">${i.name} <span style="color:#6B7280;">x${i.qty}</span></td>
      <td style="padding:8px 0;border-bottom:1px solid #F3F4F6;color:#111827;font-size:14px;text-align:right;white-space:nowrap;">${i.subtotal}</td>
    </tr>
  `).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-bottom:8px;">${rows}</table>`;
}

function ctaButton(url: string, label: string) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 0 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-radius:12px;background-color:#4F46E5;background-image:linear-gradient(to right,#4F46E5,#9333EA);">
        <a href="${url}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;font-family:Arial,Helvetica,sans-serif;">${label}</a>
      </td>
    </tr></table>
  </td></tr></table>`;
}

function footNote(text: string) {
  return `<p style="margin:24px 0 0;font-size:13px;color:#9CA3AF;text-align:center;font-family:Arial,Helvetica,sans-serif;">${text}</p>`;
}

async function send(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) return;
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) console.error('[email]', error);
}

// ── 1. Reserva/pedido creado → vendor ───────────────────────────────────────
export async function sendBookingCreatedToVendor(opts: {
  vendorEmail: string;
  vendorName: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  date: Date;
  amount: number;
  orderMode?: OrderMode;
  notes?: string | null;
  deliveryAddress?: string | null;
}) {
  if (opts.orderMode === 'ORDER') {
    const order = parseOrderNotes(opts.notes);
    const address = opts.deliveryAddress || order.address;
    let rows = dataRow('Cliente', opts.clientName);
    rows += dataRow('Fecha de entrega', dateOnly(opts.date));
    if (address) rows += dataRow('Dirección de entrega', address);
    if (order.extraNotes) rows += dataRow('Notas del cliente', order.extraNotes);
    rows += dataRow('Total', `S/ ${opts.amount.toFixed(2)}`, { valueColor: '#4F46E5', big: true, last: true });

    await send(opts.vendorEmail, `Nuevo pedido recibido 🛍️ — ${opts.businessName}`, base(`
      ${heading('Nuevo pedido recibido 🛍️', `Tienes un nuevo pedido en <strong>${opts.businessName}</strong>.`)}
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em;font-family:Arial,Helvetica,sans-serif;">Productos</p>
      ${order.items.length > 0 ? itemsTable(order.items) : `<p style="margin:0 0 8px;color:#6B7280;font-size:13px;font-style:italic;">Detalle de productos no disponible.</p>`}
      ${dataTable(rows)}
      ${ctaButton(`${APP_URL}/dashboard`, 'Ver en mi dashboard')}
    `));
    return;
  }

  await send(opts.vendorEmail, `Nueva reserva — ${opts.serviceName}`, base(`
    ${heading('📅 Nueva reserva recibida', `Tienes una nueva reserva en <strong>${opts.businessName}</strong>.`)}
    ${dataTable(
      dataRow('Cliente', opts.clientName) +
      dataRow('Servicio', opts.serviceName) +
      dataRow('Fecha', dateTime(opts.date)) +
      dataRow('Monto', `S/ ${opts.amount.toFixed(2)}`, { valueColor: '#4F46E5', big: true, last: true })
    )}
    ${ctaButton(`${APP_URL}/dashboard`, 'Ver en mi dashboard')}
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
  orderMode?: OrderMode;
  notes?: string | null;
  deliveryAddress?: string | null;
}) {
  const waLink = `https://wa.me/51${opts.businessPhone.replace(/\D/g, '')}`;

  if (opts.orderMode === 'ORDER') {
    const order = parseOrderNotes(opts.notes);
    const address = opts.deliveryAddress || order.address;
    let rows = dataRow('Negocio', opts.businessName);
    rows += dataRow('Fecha de entrega', dateOnly(opts.date));
    if (address) rows += dataRow('Dirección de entrega', address);
    rows += dataRow('WhatsApp', `<a href="${waLink}" style="color:#22C55E;font-weight:600;">${opts.businessPhone}</a>`);
    rows += dataRow('Pagado', `S/ ${opts.amount.toFixed(2)}`, { valueColor: '#4F46E5', big: true, last: true });

    await send(opts.clientEmail, `¡Pedido confirmado! — ${opts.businessName}`, base(`
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;background-color:#DCFCE7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">✅</div>
      </div>
      <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">¡Tu pedido fue confirmado!</h2>
      <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">Hola <strong>${opts.clientName}</strong>, tu pago fue procesado exitosamente.</p>
      ${order.items.length > 0 ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em;font-family:Arial,Helvetica,sans-serif;">Tu pedido</p>${itemsTable(order.items)}` : ''}
      ${dataTable(rows)}
      ${footNote('¡Te esperamos! Si necesitas cambios contáctanos por WhatsApp.')}
      ${ctaButton(`${APP_URL}/bookings`, 'Ver mi pedido')}
    `));
    return;
  }

  await send(opts.clientEmail, `¡Reserva confirmada! — ${opts.serviceName}`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#DCFCE7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">✅</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">¡Tu reserva está confirmada!</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">Hola <strong>${opts.clientName}</strong>, tu pago fue procesado exitosamente.</p>
    ${dataTable(
      dataRow('Negocio', opts.businessName) +
      dataRow('Servicio', opts.serviceName) +
      dataRow('Fecha', dateTime(opts.date)) +
      dataRow('WhatsApp', `<a href="${waLink}" style="color:#22C55E;font-weight:600;">${opts.businessPhone}</a>`) +
      dataRow('Pagado', `S/ ${opts.amount.toFixed(2)}`, { valueColor: '#4F46E5', big: true, last: true })
    )}
    ${footNote('¡Te esperamos! Si necesitas cambios contáctanos por WhatsApp.')}
    ${ctaButton(`${APP_URL}/bookings`, 'Ver mi reserva')}
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
  orderMode?: OrderMode;
  notes?: string | null;
}) {
  const isOrder = opts.orderMode === 'ORDER';
  const dateLabel = isOrder ? 'Fecha de entrega' : 'Fecha cita';
  const dateStr = isOrder ? dateOnly(opts.date) : dateTime(opts.date);
  const order = isOrder ? parseOrderNotes(opts.notes) : null;

  await send(opts.vendorEmail, `💰 Pago recibido — ${opts.serviceName}`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#DCFCE7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">💰</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">¡Pago recibido!</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">Se acaba de procesar un pago en <strong>${opts.businessName}</strong>.</p>
    ${order && order.items.length > 0
      ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em;font-family:Arial,Helvetica,sans-serif;">Pedido</p>${itemsTable(order.items)}`
      : ''}
    ${dataTable(
      dataRow('Cliente', opts.clientName) +
      (order && order.items.length > 0 ? '' : dataRow(isOrder ? 'Pedido' : 'Servicio', opts.serviceName)) +
      dataRow(dateLabel, dateStr) +
      dataRow('Total cobrado', `S/ ${opts.amount.toFixed(2)}`) +
      dataRow('Comisión NegociClick', `− S/ ${opts.commission.toFixed(2)}`, { valueColor: '#EF4444' }) +
      dataRow('Tu ganancia neta', `S/ ${opts.vendorAmount.toFixed(2)}`, { valueColor: '#22C55E', big: true, last: true })
    )}
    ${ctaButton(`${APP_URL}/dashboard`, 'Ver en mi dashboard')}
  `));
}

// ── 4. Recordatorio de reseña → cliente ─────────────────────────────────────
export async function sendReviewReminderToClient(opts: {
  clientEmail: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  orderMode?: OrderMode;
}) {
  const isOrder = opts.orderMode === 'ORDER';
  await send(opts.clientEmail, isOrder ? `¿Cómo estuvo tu pedido en ${opts.businessName}?` : `¿Cómo estuvo tu cita en ${opts.businessName}?`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#FEF3C7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">⭐</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">¿Cómo te fue?</h2>
    <p style="margin:0 0 16px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.clientName}</strong>, ${isOrder
        ? `tu pedido de <strong>${opts.serviceName}</strong> en <strong>${opts.businessName}</strong> fue entregado.`
        : `tu cita de <strong>${opts.serviceName}</strong> en <strong>${opts.businessName}</strong> fue completada.`}
    </p>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Tu opinión ayuda a otros clientes a elegir mejor. ¡Solo toma 30 segundos!
    </p>
    ${ctaButton(`${APP_URL}/bookings`, 'Dejar mi reseña ⭐')}
    ${footNote('Si ya dejaste tu reseña, ignora este correo.')}
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
      <div style="display:inline-block;background-color:#EDE9FE;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">🔐</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">Recupera tu contraseña</h2>
    <p style="margin:0 0 16px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.name}</strong>, recibimos una solicitud para restablecer la contraseña de tu cuenta NegociClick.
    </p>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Haz clic en el botón de abajo. El enlace es válido por <strong>30 minutos</strong>.
    </p>
    ${ctaButton(opts.resetUrl, 'Restablecer contraseña')}
    ${footNote('Si no solicitaste este cambio, ignora este correo. Tu contraseña no cambiará.')}
  `));
}

// ── 6. Recordatorio 24h antes de la cita → cliente (solo negocios APPOINTMENT) ──
export async function sendAppointmentReminder(opts: {
  clientEmail: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  businessPhone: string;
  date: Date;
}) {
  await send(opts.clientEmail, '⏰ Recordatorio — tu cita es mañana', base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#DBEAFE;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">⏰</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">¡Tu cita es mañana!</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.clientName}</strong>, te recordamos que tienes una cita programada.
    </p>
    ${dataTable(
      dataRow('Negocio', opts.businessName) +
      dataRow('Servicio', opts.serviceName) +
      dataRow('Fecha', dateTime(opts.date)) +
      dataRow('Contacto', `<a href="https://wa.me/51${opts.businessPhone.replace(/\D/g, '')}" style="color:#22C55E;font-weight:600;">${opts.businessPhone}</a>`, { last: true })
    )}
    ${footNote('Si necesitas reagendar, contáctanos por WhatsApp.')}
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
      <div style="display:inline-block;background-color:#DCFCE7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">✉️</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">Verifica tu correo</h2>
    <p style="margin:0 0 16px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.name}</strong>, haz clic en el botón para verificar tu correo electrónico.
    </p>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      El enlace es válido por <strong>24 horas</strong>.
    </p>
    ${ctaButton(opts.verifyUrl, 'Verificar mi correo')}
    ${footNote('Si no creaste esta cuenta, ignora este correo.')}
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
  await send(opts.email, `${emoji} Plan ${opts.plan} activado — NegociClick`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#EDE9FE;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">${emoji}</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">¡Plan ${opts.plan} activado!</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.name}</strong>, tu suscripción al plan <strong>${opts.plan}</strong> fue activada exitosamente.
    </p>
    ${dataTable(
      dataRow('Plan', opts.plan) +
      dataRow('Monto cobrado', opts.price === 0 ? 'Gratis' : `S/ ${opts.price.toFixed(2)}`, { valueColor: '#4F46E5', big: true, last: true })
    )}
    ${ctaButton(`${APP_URL}/dashboard`, 'Ir a mi dashboard')}
    ${footNote('Si no realizaste esta acción, contáctanos de inmediato.')}
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
  const endStr = opts.endDate.toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const urgency = opts.daysLeft === 1
    ? { icon: '🚨', bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B', label: '¡Último aviso!' }
    : { icon: '⏳', bg: '#FEF9C3', border: '#FDE047', text: '#854D0E', label: 'Aviso de vencimiento' };

  await send(opts.email, `${emoji} Tu plan ${opts.plan} vence en ${opts.daysLeft} día${opts.daysLeft !== 1 ? 's' : ''} — NegociClick`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#FEF3C7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">${urgency.icon}</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">${urgency.label}: tu plan ${opts.plan} vence pronto</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.name}</strong>, tu suscripción al plan <strong>${opts.plan}</strong>
      vence el <strong>${endStr}</strong> (en <strong>${opts.daysLeft} día${opts.daysLeft !== 1 ? 's' : ''}</strong>).
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${urgency.bg};border:1px solid ${urgency.border};border-radius:12px;margin-bottom:8px;">
      <tr><td style="padding:16px;text-align:center;">
        <p style="margin:0;font-size:14px;color:${urgency.text};font-family:Arial,Helvetica,sans-serif;">
          ⚠️ Si no renuevas, tu cuenta volverá al <strong>plan FREE</strong> automáticamente
          y solo podrás tener hasta 5 servicios activos. Los servicios adicionales se ocultarán temporalmente.
        </p>
      </td></tr>
    </table>
    ${ctaButton(`${APP_URL}/subscription`, 'Renovar mi plan ahora')}
    ${footNote(`¿Tienes dudas? Escríbenos a <a href="mailto:noreply@negociclick.com" style="color:#4F46E5;">noreply@negociclick.com</a>`)}
  `));
}

// ── 10. Suscripción vencida → plan degradado a FREE → vendor ────────────────
export async function sendSubscriptionExpired(opts: {
  email: string;
  name: string;
  plan: string;
}) {
  await send(opts.email, `Tu plan ${opts.plan} ha vencido — NegociClick`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#FEE2E2;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">😔</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">Tu plan ${opts.plan} ha vencido</h2>
    <p style="margin:0 0 16px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.name}</strong>, tu suscripción al plan <strong>${opts.plan}</strong> ha expirado
      y tu cuenta ha sido movida al <strong>plan FREE</strong>.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F4F6;border-radius:12px;margin-bottom:8px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#374151;font-weight:600;font-family:Arial,Helvetica,sans-serif;">¿Qué significa esto?</p>
        <ul style="margin:0;padding-left:20px;font-size:13px;color:#6B7280;line-height:1.8;font-family:Arial,Helvetica,sans-serif;">
          <li>Tu negocio permanece visible en NegociClick</li>
          <li>Solo puedes tener hasta <strong>5 servicios activos</strong></li>
          <li>Los servicios adicionales fueron ocultados temporalmente (no eliminados)</li>
          <li>Al renovar, todos tus servicios se reactivarán automáticamente</li>
        </ul>
      </td></tr>
    </table>
    ${ctaButton(`${APP_URL}/subscription`, 'Reactivar mi plan')}
    ${footNote(`¿Necesitas ayuda? Escríbenos a <a href="mailto:noreply@negociclick.com" style="color:#4F46E5;">noreply@negociclick.com</a>`)}
  `));
}

// ── 11. Reserva/pedido cancelado → cliente ──────────────────────────────────
export async function sendBookingCancelledToClient(opts: {
  clientEmail: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  orderMode?: OrderMode;
}) {
  const isOrder = opts.orderMode === 'ORDER';
  await send(opts.clientEmail, isOrder ? `Pedido cancelado — ${opts.businessName}` : `Reserva cancelada — ${opts.serviceName}`, base(`
    ${heading(isOrder ? 'Pedido cancelado' : 'Reserva cancelada')}
    <p style="margin:0 0 16px;color:#6B7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">Hola <strong>${opts.clientName}</strong>, ${isOrder
      ? `tu pedido en <strong>${opts.businessName}</strong> ha sido cancelado.`
      : `tu reserva de <strong>${opts.serviceName}</strong> en <strong>${opts.businessName}</strong> ha sido cancelada.`}
    </p>
    ${footNote(`Si tienes dudas${isOrder ? '' : ' o quieres reagendar'}, visita NegociClick o contáctanos.`)}
  `));
}

// ── 12. Reserva/pedido cancelado por cliente → vendor ───────────────────────
export async function sendBookingCancelledToVendor(opts: {
  vendorEmail: string;
  vendorName: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  date: Date;
  orderMode?: OrderMode;
}) {
  const isOrder = opts.orderMode === 'ORDER';
  const dateStr = isOrder ? dateOnly(opts.date) : dateTime(opts.date);
  await send(opts.vendorEmail, isOrder ? `Pedido cancelado — ${opts.businessName}` : `Reserva cancelada — ${opts.serviceName}`, base(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;font-family:Arial,Helvetica,sans-serif;">${isOrder ? 'Pedido cancelado por el cliente' : 'Reserva cancelada por el cliente'}</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">El cliente <strong>${opts.clientName}</strong> canceló su ${isOrder ? 'pedido' : 'reserva'} en <strong>${opts.businessName}</strong>.</p>
    ${dataTable(
      dataRow(isOrder ? 'Pedido' : 'Servicio', opts.serviceName) +
      dataRow(isOrder ? 'Fecha de entrega' : 'Fecha cancelada', dateStr, { valueColor: '#9CA3AF', last: true })
    )}
    ${ctaButton(`${APP_URL}/dashboard`, 'Ver en mi dashboard')}
  `));
}

// ── 13. Reserva reagendada / cambio de fecha de entrega → vendor ───────────
export async function sendBookingRescheduledToVendor(opts: {
  vendorEmail: string;
  vendorName: string;
  clientName: string;
  serviceName: string;
  businessName: string;
  oldDate: Date;
  newDate: Date;
  orderMode?: OrderMode;
}) {
  const isOrder = opts.orderMode === 'ORDER';
  const fmt = isOrder ? dateOnly : dateTime;
  await send(opts.vendorEmail, isOrder ? `Cambio de fecha de entrega — ${opts.businessName}` : `Reserva reagendada — ${opts.serviceName}`, base(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;font-family:Arial,Helvetica,sans-serif;">${isOrder ? '🔄 Cambio de fecha de entrega' : '🔄 Reserva reagendada'}</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">El cliente <strong>${opts.clientName}</strong> cambió ${isOrder ? 'la fecha de entrega de su pedido' : 'el horario de su reserva'} en <strong>${opts.businessName}</strong>.</p>
    ${dataTable(
      dataRow(isOrder ? 'Pedido' : 'Servicio', opts.serviceName) +
      dataRow('Antes', fmt(opts.oldDate), { valueColor: '#9CA3AF' }) +
      dataRow(isOrder ? 'Nueva fecha de entrega' : 'Nuevo horario', fmt(opts.newDate), { valueColor: '#4F46E5', last: true })
    )}
    ${ctaButton(`${APP_URL}/dashboard`, 'Ver en mi dashboard')}
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
    ${heading('⭐ Tu destacado vence pronto')}
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.name}</strong>, tu negocio <strong>${opts.businessName}</strong> dejará de aparecer
      destacado en <strong>${opts.daysLeft} día${opts.daysLeft !== 1 ? 's' : ''}</strong> (${dateStr}).
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;margin-bottom:8px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0;font-size:14px;color:#92400E;font-family:Arial,Helvetica,sans-serif;">
          ⏰ Renueva ahora para seguir apareciendo primero en los resultados y con badge dorado.
        </p>
      </td></tr>
    </table>
    ${ctaButton(`${APP_URL}/dashboard`, 'Renovar Destacado')}
    ${footNote('Si ya no quieres renovar, tu negocio seguirá activo pero sin la posición destacada.')}
  `));
}

// ── 15. Destacado expirado → vendor ─────────────────────────────────────────
export async function sendFeaturedExpired(opts: {
  email: string;
  name: string;
  businessName: string;
}) {
  await send(opts.email, `Tu Negocio Destacado expiró — ${opts.businessName}`, base(`
    ${heading('Tu período destacado terminó')}
    <p style="margin:0 0 16px;color:#6B7280;font-size:14px;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.name}</strong>, el período de <strong>${opts.businessName}</strong> como
      Negocio Destacado ha vencido. Tu negocio sigue activo, pero ya no aparecerá primero ni con el badge dorado.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;margin-bottom:8px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:14px;color:#111827;font-weight:600;font-family:Arial,Helvetica,sans-serif;">¿Quieres volver a destacarte?</p>
        <p style="margin:0;font-size:14px;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">
          Desde S/ 19.90 por 7 días · S/ 34.90 por 15 días · S/ 59.90 por 30 días
        </p>
      </td></tr>
    </table>
    ${ctaButton(`${APP_URL}/dashboard`, 'Volver a Destacar')}
    ${footNote('Tu negocio seguirá recibiendo reservas normalmente.')}
  `));
}

// ── 16. Bienvenida vendor (onboarding) ──────────────────────────────────────
export async function sendWelcomeVendor(opts: {
  email: string;
  name: string;
}) {
  await send(opts.email, '¡Bienvenido a NegociClick! Configura tu negocio en 3 pasos', base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#EDE9FE;border-radius:50%;width:72px;height:72px;line-height:72px;font-size:36px;">🚀</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:22px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">¡Hola, ${opts.name}!</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:15px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Tu cuenta de negocio en <strong>NegociClick</strong> fue creada exitosamente.<br/>
      Sigue estos pasos para empezar a recibir reservas:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;border-radius:14px;margin-bottom:8px;">
      <tr><td style="padding:20px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="36" valign="top" style="padding-bottom:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:36px;height:36px;background-color:#4F46E5;background-image:linear-gradient(to right,#4F46E5,#9333EA);border-radius:50%;color:#ffffff;font-weight:700;font-size:16px;text-align:center;font-family:Arial,Helvetica,sans-serif;">1</td></tr></table>
            </td>
            <td valign="top" style="padding:0 0 16px 14px;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;">Crea tu negocio</p>
              <p style="margin:0;font-size:13px;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Ve a tu dashboard → "Negocios" → "Agregar negocio". Completa nombre, categoría, dirección y teléfono.</p>
            </td>
          </tr>
          <tr>
            <td width="36" valign="top" style="padding-bottom:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:36px;height:36px;background-color:#4F46E5;background-image:linear-gradient(to right,#4F46E5,#9333EA);border-radius:50%;color:#ffffff;font-weight:700;font-size:16px;text-align:center;font-family:Arial,Helvetica,sans-serif;">2</td></tr></table>
            </td>
            <td valign="top" style="padding:0 0 16px 14px;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;">Agrega tus servicios y precios</p>
              <p style="margin:0;font-size:13px;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">En el tab "Servicios" agrega lo que ofreces con precio y duración. Usa las plantillas predefinidas para ahorrar tiempo.</p>
            </td>
          </tr>
          <tr>
            <td width="36" valign="top">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:36px;height:36px;background-color:#4F46E5;background-image:linear-gradient(to right,#4F46E5,#9333EA);border-radius:50%;color:#ffffff;font-weight:700;font-size:16px;text-align:center;font-family:Arial,Helvetica,sans-serif;">3</td></tr></table>
            </td>
            <td valign="top" style="padding:0 0 0 14px;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;">Sube tu foto de portada</p>
              <p style="margin:0;font-size:13px;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Los negocios con foto reciben <strong>3× más visitas</strong>. En el tab "Perfil" puedes subir tu imagen de portada y fotos de tu local.</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;margin-bottom:8px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0;font-size:13px;color:#92400E;font-family:Arial,Helvetica,sans-serif;">
          ⚡ <strong>Tip:</strong> Los negocios que completan su perfil en las primeras 24h consiguen sus primeras reservas más rápido.
        </p>
      </td></tr>
    </table>
    ${ctaButton(`${APP_URL}/dashboard`, 'Ir a mi dashboard')}
    ${footNote('¿Tienes dudas? Escríbenos por WhatsApp: <a href="https://wa.me/51983081196" style="color:#4F46E5;">+51 983 081 196</a>')}
  `));
}

// ── 17. Bienvenida cliente ───────────────────────────────────────────────────
export async function sendWelcomeClient(opts: {
  email: string;
  name: string;
}) {
  const features = [
    { emoji: '🔍', title: 'Explora negocios', desc: 'Busca por categoría, ciudad o nombre. Filtra por precio y rating.' },
    { emoji: '📅', title: 'Reserva en segundos', desc: 'Elige el servicio, fecha y hora. Recibe confirmación inmediata.' },
    { emoji: '⭐', title: 'Deja tu reseña', desc: 'Tu opinión ayuda a otros y premia a los mejores negocios.' },
  ];
  await send(opts.email, '¡Bienvenido a NegociClick! Encuentra los mejores servicios en Lima', base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#DCFCE7;border-radius:50%;width:72px;height:72px;line-height:72px;font-size:36px;">✨</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:22px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">¡Hola, ${opts.name}!</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:15px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Bienvenido a <strong>NegociClick</strong>, el marketplace de servicios en Lima.<br/>
      Reserva barberos, dentistas, spas, nutricionistas y mucho más en segundos.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
      ${features.map(({ emoji, title, desc }) => `
        <tr><td style="padding-bottom:12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;border-radius:12px;">
            <tr>
              <td width="40" valign="top" style="padding:14px 0 14px 16px;font-size:22px;">${emoji}</td>
              <td valign="top" style="padding:14px 16px 14px 12px;">
                <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;">${title}</p>
                <p style="margin:0;font-size:13px;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">${desc}</p>
              </td>
            </tr>
          </table>
        </td></tr>
      `).join('')}
    </table>
    ${ctaButton(APP_URL, 'Explorar servicios')}
    ${footNote('¿Necesitas ayuda? <a href="https://wa.me/51983081196" style="color:#4F46E5;">WhatsApp +51 983 081 196</a>')}
  `));
}

// ── 18. Cambio de estado del pedido (preparando / entregado) → cliente ─────
export async function sendOrderStatusUpdateToClient(opts: {
  clientEmail: string;
  clientName: string;
  businessName: string;
  status: 'PREPARING' | 'DELIVERED';
}) {
  const meta = opts.status === 'PREPARING'
    ? { emoji: '👨‍🍳', title: 'Tu pedido está en preparación', text: 'está siendo preparado' }
    : { emoji: '📦', title: '¡Tu pedido fue entregado!', text: 'fue entregado' };

  await send(opts.clientEmail, `${meta.emoji} ${meta.title} — ${opts.businessName}`, base(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background-color:#DBEAFE;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;">${meta.emoji}</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;text-align:center;font-family:Arial,Helvetica,sans-serif;">${meta.title}</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Hola <strong>${opts.clientName}</strong>, tu pedido en <strong>${opts.businessName}</strong> ${meta.text}.
    </p>
    ${ctaButton(`${APP_URL}/bookings`, 'Ver mi pedido')}
  `));
}
