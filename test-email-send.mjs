/**
 * Test script to verify email sending functionality
 * Run with: node test-email-send.mjs <email-address>
 */
import { Resend } from 'resend';
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: join(__dirname, '.env') });

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || '';
const testEmail = process.argv[2] || 'komorebidev@gmail.com';

console.log('📧 Email Configuration Test\n');
console.log('==================================================');
console.log('Configuration:');
console.log(`  RESEND_API_KEY: ${RESEND_API_KEY ? '✅ Set (' + RESEND_API_KEY.substring(0, 10) + '...)' : '❌ Missing'}`);
console.log(`  RESEND_FROM_EMAIL: ${RESEND_FROM_EMAIL || '❌ Missing'}`);
console.log(`  Test recipient: ${testEmail}`);
console.log('==================================================\n');

if (!RESEND_API_KEY) {
  console.error('❌ RESEND_API_KEY is not set!');
  console.error('   Make sure you have a .env file with RESEND_API_KEY');
  process.exit(1);
}

if (!RESEND_FROM_EMAIL) {
  console.error('❌ RESEND_FROM_EMAIL is not set!');
  console.error('   Make sure you have a .env file with RESEND_FROM_EMAIL');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

console.log('📤 Attempting to send test email...\n');

try {
  const result = await resend.emails.send({
    from: RESEND_FROM_EMAIL,
    to: testEmail,
    subject: 'Test Email from Spanish Blitz',
    html: `
      <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #111827;">✅ EMAIL TEST SUCCESSFUL!</h2>
        <p style="color: #374151;">This is a test email from Spanish Blitz.</p>
        <p style="color: #374151;">If you received this, the email service is working correctly.</p>
        <p style="color:#6b7280;margin-top:16px;font-size:13px;">Sent from: ${RESEND_FROM_EMAIL}</p>
      </div>
    `,
    text: `✅ EMAIL TEST SUCCESSFUL!\n\nThis is a test email from Spanish Blitz.\n\nIf you received this, the email service is working correctly.\n\nSent from: ${RESEND_FROM_EMAIL}`
  });

  if (result.error) {
    console.error('❌ Email send failed:');
    console.error('  Error:', result.error);
    console.error('  Status Code:', result.error.statusCode);
    console.error('  Message:', result.error.message);
    process.exit(1);
  }

  console.log('✅ Email sent successfully!');
  console.log('  Email ID:', result.data?.id);
  console.log('  From:', RESEND_FROM_EMAIL);
  console.log('  To:', testEmail);
  console.log('\n📬 Check your inbox (and spam folder) for the test email.');
  console.log('💡 You can also check the Resend dashboard for delivery status.');
} catch (error) {
  console.error('❌ Exception during email send:');
  console.error('  Error:', error.message);
  if (error.stack) {
    console.error('  Stack:', error.stack);
  }
  process.exit(1);
}

