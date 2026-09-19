const path = require("path");
const fs = require("fs");
const ejs = require("ejs");

const file = "D:\\frontend _practice\\IEEE WEB\\SANAD3\\public\\views\\pages\\beneficiaries.ejs";
const opts = {
    filename: file,
};
const model = {
    user: { id: 1, name: "م", role: "admin" },
    isAuthenticated: true,
    userRole: "admin",
};
ejs.renderFile(file, model, opts, (err, html) => {
    if (err) {
        console.error("RENDER_ERROR:", err.message);
        process.exit(1);
    }
    const opens = (html.match(/<div[\s>]/g) || []).length;
    const closes = (html.match(/<\/div\s*>/g) || []).length;
    console.log("RENDER_OK bytes=" + Buffer.byteLength(html) + " divOpen=" + opens + " divClose=" + closes);
    process.exit(0);
});
