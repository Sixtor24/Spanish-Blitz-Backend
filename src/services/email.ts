/**
 * Email service using Resend
 */
import { Resend } from 'resend';
import { config } from '../config/env.js';

const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

export async function sendEmail({ 
  to, 
  subject, 
  html 
}: { 
  to: string; 
  subject: string; 
  html: string 
}) {
  if (!resend || !config.RESEND_FROM_EMAIL) {
    console.warn('[email] Missing RESEND_API_KEY or RESEND_FROM_EMAIL; skipping send');
    return;
  }

  try {
    const result = await resend.emails.send({ 
      from: config.RESEND_FROM_EMAIL, 
      to, 
      subject, 
      html 
    });
    console.info('[email] send attempt', { 
      to, 
      subject, 
      id: result?.data?.id, 
      error: result?.error 
    });
  } catch (err) {
    console.error('[email] Failed to send', err);
  }
}

export function premiumActivatedTemplate({ 
  name, 
  email 
}: { 
  name?: string | null; 
  email: string 
}) {
  const displayName = name || email;
  return `
    <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #111827;">¡Acceso Premium activado!</h2>
      <p style="color: #374151;">Hola ${displayName},</p>
      <p style="color: #374151;">Un admin activó tu plan <strong>Premium</strong>. Ya puedes acceder a todas las funcionalidades.</p>
      <a href="${config.APP_BASE_URL}" style="display:inline-block;margin-top:16px;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;">Ir al dashboard</a>
      <p style="color:#6b7280;margin-top:16px;font-size:13px;">Si no reconoces este cambio, responde a este correo.</p>
    </div>
  `;
}

export function resetPasswordTemplate({ resetLink }: { resetLink: string }) {
  return `
    <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #111827;">Restablece tu contraseña</h2>
      <p style="color: #374151;">Recibimos una solicitud para restablecer tu contraseña.</p>
      <p style="color: #374151;">Haz clic en el botón para continuar. El enlace expira en 1 hora.</p>
      <a href="${resetLink}" style="display:inline-block;margin-top:16px;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;">Restablecer contraseña</a>
      <p style="color:#6b7280;margin-top:16px;font-size:13px;">Si no solicitaste esto, puedes ignorar este correo.</p>
    </div>
  `;
}

