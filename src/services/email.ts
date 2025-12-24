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
  console.log(`[email] 📧 sendEmail called:`, {
    to,
    subject,
    from: config.RESEND_FROM_EMAIL,
    hasResend: !!resend,
    hasFromEmail: !!config.RESEND_FROM_EMAIL
  });

  if (!resend || !config.RESEND_FROM_EMAIL) {
    console.error('[email] ❌ Missing configuration:', {
      hasResend: !!resend,
      hasFromEmail: !!config.RESEND_FROM_EMAIL,
      fromEmail: config.RESEND_FROM_EMAIL
    });
    throw new Error('Email service not configured: Missing RESEND_API_KEY or RESEND_FROM_EMAIL');
  }

  try {
    console.log(`[email] 📤 Sending email via Resend:`, {
      from: config.RESEND_FROM_EMAIL,
      to,
      subject
    });

    const result = await resend.emails.send({ 
      from: config.RESEND_FROM_EMAIL, 
      to, 
      subject, 
      html 
    });
    
    if (result.error) {
      console.error('[email] ❌ Resend API error:', { 
        to, 
        subject,
        from: config.RESEND_FROM_EMAIL,
        error: result.error,
        message: result.error.message,
        name: result.error.name,
        fullError: JSON.stringify(result.error, null, 2)
      });
      
      // Provide more helpful error messages
      const errorMessage = result.error.message || 'Email send failed';
      if (errorMessage.includes('domain') || errorMessage.includes('Domain')) {
        throw new Error(`Domain verification issue: ${errorMessage}. Please verify the domain '${config.RESEND_FROM_EMAIL?.split('@')[1]}' in Resend dashboard.`);
      }
      throw new Error(errorMessage);
    }
    
    console.log('[email] ✅ Email sent successfully via Resend:', { 
      to, 
      subject,
      from: config.RESEND_FROM_EMAIL,
      id: result?.data?.id,
      emailId: result?.data?.id
    });
    
    return result.data;
  } catch (err: any) {
    console.error('[email] ❌ Exception during send:', { 
      to, 
      subject,
      from: config.RESEND_FROM_EMAIL,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      errorType: err?.constructor?.name
    });
    throw err;
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

