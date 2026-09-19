import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log("=== Testing Admin Sidebar & Notification Setup ===");

// 1. Inspect admin.css
const adminCssPath = path.resolve('public/CSS/admin.css');
const adminCss = fs.readFileSync(adminCssPath, 'utf8').replace(/\r\n/g, '\n');

assert(adminCss.includes('.admin-sidebar-top-actions'), "admin.css must include .admin-sidebar-top-actions");
assert(adminCss.includes('.admin-sidebar-actions-group'), "admin.css must include .admin-sidebar-actions-group");
assert(adminCss.includes('.admin-sidebar-drawer'), "admin.css must include .admin-sidebar-drawer");
assert(adminCss.includes('margin-right: auto !important'), "admin.css must have margin-right: auto for toggle in RTL");
assert(!adminCss.includes('top: 10px;\n        right: 10px;'), "admin.css must not have overriding top: 10px; right: 10px in 576px media query");
assert(adminCss.includes('.admin-sidebar-user span {\n    display: none !important;'), "admin.css must hide user text span by default");
assert(adminCss.includes('.admin-sidebar-footer'), "admin.css must include .admin-sidebar-footer");
assert(!adminCss.includes('.admin-sidebar-logout span {\n        display: none;'), "admin.css must not hide logout span on <=400px");
console.log("✓ admin.css checks passed!");

// 2. Inspect admin-sidebar.ejs and navbar.ejs
const ejsPath = path.resolve('public/views/partials/admin-sidebar.ejs');
const ejsContent = fs.readFileSync(ejsPath, 'utf8');

assert(ejsContent.includes('id="adminSidebarToggle"'), "admin-sidebar.ejs must include adminSidebarToggle");
assert(ejsContent.includes('class="admin-sidebar-actions-group"'), "admin-sidebar.ejs must include admin-sidebar-actions-group");
assert(ejsContent.includes('id="headerNotificationBtn"'), "admin-sidebar.ejs must include headerNotificationBtn");
assert(ejsContent.includes('id="headerNotificationDropdown"'), "admin-sidebar.ejs must include headerNotificationDropdown");
assert(ejsContent.includes('class="admin-sidebar-drawer"'), "admin-sidebar.ejs must include admin-sidebar-drawer");
assert(ejsContent.includes('class="admin-sidebar-footer"'), "admin-sidebar.ejs must include admin-sidebar-footer with logout");
console.log("✓ admin-sidebar.ejs checks passed!");

const navbarEjsPath = path.resolve('public/views/partials/navbar.ejs');
const navbarEjs = fs.readFileSync(navbarEjsPath, 'utf8');
assert(navbarEjs.includes('nav-menu-logout-btn'), "navbar.ejs must include nav-menu-logout-btn inside navMenu");
console.log("✓ navbar.ejs checks passed!");

// 3. Inspect header-notifications.js and admin-sidebar.js
const headerNotifJs = fs.readFileSync(path.resolve('public/JS/header-notifications.js'), 'utf8');
assert(headerNotifJs.includes('adminLayout.classList.contains("sidebar-open")'), "header-notifications.js must close sidebar when opening dropdown");

const adminSidebarJs = fs.readFileSync(path.resolve('public/JS/admin-sidebar.js'), 'utf8');
assert(adminSidebarJs.includes('headerNotificationDropdown'), "admin-sidebar.js must close notifications when opening sidebar");

const navbarAuthJs = fs.readFileSync(path.resolve('public/JS/navbar-auth.js'), 'utf8');
assert(navbarAuthJs.includes('document.querySelectorAll(".user-actions")'), "navbar-auth.js must toggle all .user-actions elements");
console.log("✓ JS interaction checks passed!");

// 4. Test HTTP routes
function get(urlPath) {
    return new Promise((resolve, reject) => {
        http.get('http://localhost:3000' + urlPath, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        }).on('error', reject);
    });
}

async function runHttpTests() {
    const assets = [
        '/CSS/admin.css',
        '/CSS/navbar.css',
        '/CSS/responsive.css',
        '/JS/admin-sidebar.js',
        '/JS/header-notifications.js',
        '/JS/navbar.js'
    ];

    for (const asset of assets) {
        const res = await get(asset);
        assert.strictEqual(res.status, 200, `Asset ${asset} must return 200`);
        console.log(`✓ Asset ${asset} loaded: ${res.status}`);
    }

    const pages = [
        '/',
        '/login',
        '/signup'
    ];

    for (const p of pages) {
        const res = await get(p);
        assert(res.status === 200 || res.status === 302, `Page ${p} must respond`);
        console.log(`✓ Route ${p} responded: ${res.status}`);
    }

    console.log("\n ALL ADMIN SIDEBAR & NOTIFICATIONS TESTS PASSED SUCCESSFULLY! \n");
}

runHttpTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
