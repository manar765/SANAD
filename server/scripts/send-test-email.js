import "dotenv/config";
import { sendVerificationEmail, testSmtpConnection } from "../email-service.js";

const targetEmail = process.argv[2] || process.env.SMTP_USER || "test@example.com";

console.log("==================================================");
console.log("  SANAD (سند) — أداة اختبار إرسال البريد الإلكتروني");
console.log("==================================================");
console.log(`- مزود الخدمة (EMAIL_PROVIDER): ${process.env.EMAIL_PROVIDER || "console"}`);
console.log(`- خادم SMTP: ${process.env.SMTP_HOST || "smtp.gmail.com"}`);
console.log(`- البريد المرسل منه: ${process.env.SMTP_USER || "غير محدد"}`);
console.log(`- البريد المستهدف: ${targetEmail}`);
console.log("--------------------------------------------------");

console.log("1. جاري التحقق من الاتصال بالخادم...");
const conn = await testSmtpConnection();
if (!conn.ok) {
  console.log(`⚠️ حالة الاتصال: ${conn.message || conn.error}`);
} else {
  console.log("✅ الاتصال بخادم البريد جاهز ومؤكد بنجاح!");
}

console.log("\n2. جاري إرسال بريد تفعيل تجريبي...");
const otpTest = String(Math.floor(100000 + Math.random() * 900000));
const urlTest = `${process.env.APP_URL || "http://localhost:3000"}/verify-email?token=test-token-${Date.now()}`;

const result = await sendVerificationEmail({
  to: targetEmail,
  name: "مستخدم تجريبي",
  verificationUrl: urlTest,
  otpCode: otpTest,
});

if (result.messageId) {
  console.log(`\n🎉 تم إرسال الرسالة بنجاح! Message ID: ${result.messageId}`);
  if (result.previewUrl) {
    console.log(`🔗 رابط استعراض البريد: ${result.previewUrl}`);
  }
} else if (result.error) {
  console.log(`\n⚠️ تعذر الإرسال الفعلي: ${result.error}`);
  console.log(`(تم حفظ الرمز احتياطيًا: ${result.otpCode})`);
} else {
  console.log(`\nℹ️ تم التشغيل في نمط Console Preview.`);
}
console.log("==================================================");
process.exit(0);
