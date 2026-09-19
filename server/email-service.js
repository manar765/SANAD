import nodemailer from "nodemailer";

let transporter;

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export async function getTransporter() {
  if (transporter) return transporter;

  const provider = (process.env.EMAIL_PROVIDER || "console").toLowerCase().trim();
  if (provider === "console") {
    return null;
  }

  if (provider === "ethereal") {
    try {
      const testAccount = await nodemailer.createTestAccount();
      console.log(`[Email Service] 📧 تم إنشاء صندوق بريد اختباري عبر Ethereal: ${testAccount.user}`);
      transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      transporter.isEthereal = true;
      return transporter;
    } catch (err) {
      console.error("[Email Service] فشل إنشاء حساب Ethereal:", err.message);
      return null;
    }
  }

  // SMTP provider
  const smtpUser = process.env.SMTP_USER?.trim() || "";
  const rawPassword = process.env.SMTP_PASSWORD || "";
  // Strip any whitespace (common when copying Google 4x4 app passwords)
  const smtpPass = rawPassword.replace(/\s+/g, "").trim();
  const smtpHost = process.env.SMTP_HOST?.trim() || "";
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const isGmail = smtpHost === "smtp.gmail.com" || (!smtpHost && smtpUser.endsWith("@gmail.com"));

  if (!smtpUser || !smtpPass) {
    console.warn("[Email Service] لم يتم العثور على SMTP_USER أو SMTP_PASSWORD في ملف .env. سيتم استخدام نمط console.");
    return null;
  }

  if (isGmail) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
  } else {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: process.env.SMTP_SECURE === "true" || smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
  }

  return transporter;
}

export async function testSmtpConnection() {
  try {
    const mailer = await getTransporter();
    if (!mailer) {
      return { ok: false, message: "EMAIL_PROVIDER is set to console or missing credentials." };
    }
    await mailer.verify();
    return { ok: true, message: "SMTP connection verified successfully." };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendVerificationEmail({ to, name, verificationUrl, otpCode }) {
  const mailer = await getTransporter();
  const safeName = escapeHtml(name) || "بك";
  const formattedOtp = otpCode ? String(otpCode).trim() : null;

  if (!mailer) {
    console.log(`[Email Service] Verification for ${to}: OTP = ${formattedOtp || "N/A"} | URL = ${verificationUrl}`);
    return { preview: true, otpCode: formattedOtp, verificationUrl };
  }

  const senderUser = process.env.SMTP_USER?.trim() || "noreply@sanad.org";
  const rawFrom = process.env.EMAIL_FROM?.trim();
  const fromAddress = rawFrom
    ? (rawFrom.includes("<") ? rawFrom : `منصة سند <${rawFrom}>`)
    : `منصة سند <${senderUser}>`;

  const otpSectionText = formattedOtp
    ? `رمز التحقق الخاص بك (OTP):\n${formattedOtp}\n(صالح لمدة 15 دقيقة)\n\nأو `
    : "";

  const otpSectionHtml = formattedOtp
    ? `<div style="margin: 24px 0; padding: 18px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; text-align: center;">
            <p style="margin: 0 0 8px 0; color: #166534; font-size: 14px; font-weight: bold;">رمز التحقق لمرة واحدة (OTP)</p>
            <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #15803d; font-family: monospace; direction: ltr;">${formattedOtp}</div>
            <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 12px;">أدخل هذا الرمز في صفحة التفعيل (صالح لمدة 15 دقيقة)</p>
          </div>
          <div style="text-align: center; margin: 16px 0; color: #9ca3af; font-size: 13px;">— أو بنقرة واحدة —</div>`
    : "";

  try {
    const info = await mailer.sendMail({
      from: fromAddress,
      to,
      subject: "تفعيل حسابك في منصة سند",
      text: `مرحبًا ${name || "بك"}\n\n${otpSectionText}اضغط على الرابط التالي لتفعيل بريدك الإلكتروني:\n${verificationUrl}\n\nالرابط صالح لمدة 24 ساعة ويُستخدم مرة واحدة.\n\nمنصة سند — لإدارة التبرعات العينية.`,
      html: `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; direction: rtl; }
  .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
  .logo { text-align: center; margin-bottom: 20px; font-size: 24px; font-weight: bold; color: #0f766e; }
  .btn { display: inline-block; background: #0f766e; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; font-size: 15px; margin: 16px 0; }
  .footer { margin-top: 28px; border-top: 1px solid #f1f5f9; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">منصة سَنَد (SANAD)</div>
    <h2 style="color: #1e293b; margin-top: 0;">مرحبًا ${safeName} 👋</h2>
    <p style="color: #475569; font-size: 15px; line-height: 1.6;">
      شكرًا لانضمامك إلى منصة سند. لإكمال تسجيل حسابك والتأكد من ملكيتك للبريد الإلكتروني، يرجى تفعيل الحساب:
    </p>
    ${otpSectionHtml}
    <div style="text-align: center;">
      <a href="${encodeURI(verificationUrl)}" class="btn">تفعيل الحساب الآن</a>
    </div>
    <p style="color: #64748b; font-size: 13px; margin-top: 20px; line-height: 1.5;">
      • رابط التفعيل صالح لمدة 24 ساعة ويُستخدم لمرة واحدة فقط.<br>
      • إذا لم تكن قد طلبت إنشاء حساب على سند، يمكنك تجاهل هذه الرسالة بأمان.
    </p>
    <div class="footer">
      منصة سند للتبرعات العينية وإدارة المستفيدين © ${new Date().getFullYear()}
    </div>
  </div>
</body>
</html>`,
    });

    console.log(`[Email Service] ✅ تم إرسال بريد التفعيل بنجاح إلى: ${to} (Message ID: ${info.messageId})`);

    if (mailer.isEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`[Email Service] 📬 رابط معاينة البريد الإلكتروني (Ethereal): ${previewUrl}`);
      return { preview: false, previewUrl, messageId: info.messageId };
    }

    return { preview: false, messageId: info.messageId };
  } catch (error) {
    console.error(`[Email Service] ❌ تعذر إرسال البريد إلى ${to}:`, error.message);
    if (error.message?.includes("535") || error.code === "EAUTH") {
      console.error(`[Email Service] 💡 تنبيه بخصوص مصادقة Gmail:
  حسابات Google لا تقبل كلمة المرور العادية للحساب عند استخدام SMTP.
  يجب استخدام "كلمة مرور التطبيقات" (App Password) المكونة من 16 حرفًا:
  1. فعّل "التحقق بخطوتين" في حساب Google الخاص بك.
  2. افتح الرابط: https://myaccount.google.com/apppasswords
  3. أنشئ كلمة مرور لتطبيق "SANAD" وانسخ الـ 16 حرفًا.
  4. ضعها في ملف .env في قيمة SMTP_PASSWORD.`);
    }
    console.log(`[Email Service] ℹ️ بيانات التفعيل الاحتياطية: OTP = ${formattedOtp || "N/A"} | URL = ${verificationUrl}`);
    return { preview: true, error: error.message, otpCode: formattedOtp, verificationUrl };
  }
}
