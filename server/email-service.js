import nodemailer from "nodemailer";

let transporter;

function escapeHtml(value) {
    return String(value || "").replace(/[&<>\"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
    })[character]);
}

function getTransporter() {
    if (transporter) return transporter;
    if ((process.env.EMAIL_PROVIDER || "console") === "console") return null;
    const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) {
        throw new Error(`Email delivery is not configured. Missing: ${missing.join(", ")}`);
    }
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
    return transporter;
}

export async function sendVerificationEmail({ to, name, verificationUrl }) {
    const mailer = getTransporter();
    if (!mailer) {
        console.log(`Email verification link for ${to}: ${verificationUrl}`);
        return { preview: true };
    }

    await mailer.sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject: "فعّل حسابك على سند",
        text: `مرحبًا ${name || "بك"}\n\nاضغط على الرابط التالي لتفعيل بريدك الإلكتروني:\n${verificationUrl}\n\nالرابط صالح لمدة 24 ساعة ويُستخدم مرة واحدة.`,
        html: `<div dir="rtl" lang="ar"><p>مرحبًا ${escapeHtml(name) || "بك"}</p><p>اضغط على الرابط التالي لتفعيل بريدك الإلكتروني:</p><p><a href="${encodeURI(verificationUrl)}">تفعيل البريد الإلكتروني</a></p><p>الرابط صالح لمدة 24 ساعة ويُستخدم مرة واحدة.</p></div>`,
    });
    return { preview: false };
}
