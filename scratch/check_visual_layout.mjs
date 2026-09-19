import { chromium } from '@playwright/test';

async function testLayout() {
    console.log("Launching browser for visual layout testing...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // ----------------------------------------------------
    // Authenticate Admin session via API
    // ----------------------------------------------------
    console.log("Authenticating as admin...");
    const loginRes = await fetch("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: process.env.ADMIN_EMAIL || "admin@sanad.com",
            password: process.env.ADMIN_PASSWORD || "Sanad@2026"
        })
    });
    const cookieHeader = loginRes.headers.get("set-cookie");
    const loginData = await loginRes.json();
    console.log("Admin login status:", loginRes.status, "user:", loginData.user?.email);

    if (cookieHeader) {
        const [cookiePair] = cookieHeader.split(";");
        const [cookieName, cookieValue] = cookiePair.split("=");
        await context.addCookies([{
            name: cookieName.trim(),
            value: cookieValue.trim(),
            domain: "localhost",
            path: "/"
        }]);
    }

    // ----------------------------------------------------
    // Test 1: Desktop Admin Sidebar (1280x800)
    // ----------------------------------------------------
    console.log("\n--- Test 1: Desktop Admin Sidebar (1280x800) ---");
    await page.setViewportSize({ width: 1280, height: 800 });

    // Seed localStorage as admin before loading dashboard
    await page.addInitScript((adminUser) => {
        localStorage.setItem("sanadUser", JSON.stringify(adminUser));
    }, loginData.user || { role: "admin", name: "مشرف النظام" });

    await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });

    // Evaluate Desktop Sidebar Collapse Button
    const desktopInfo = await page.evaluate(() => {
        const sidebar = document.getElementById("adminSidebar");
        const collapseBtn = document.getElementById("adminSidebarCollapse");
        const toolsRow = document.querySelector(".admin-sidebar-tools-row");
        const userBtn = document.getElementById("adminUserName");
        const notifBtn = document.getElementById("headerNotificationBtn");
        const themeHost = document.querySelector(".admin-theme-control");
        const toggleBtn = document.getElementById("adminSidebarToggle");

        if (!sidebar || !collapseBtn || !toolsRow) {
            return { error: "Missing admin sidebar elements" };
        }

        const sidebarRect = sidebar.getBoundingClientRect();
        const collapseRect = collapseBtn.getBoundingClientRect();
        const toolsRect = toolsRow.getBoundingClientRect();
        const userRect = userBtn ? userBtn.getBoundingClientRect() : null;

        const sidebarComputed = window.getComputedStyle(sidebar);
        const collapseComputed = window.getComputedStyle(collapseBtn);
        const toggleComputed = toggleBtn ? window.getComputedStyle(toggleBtn) : null;

        return {
            sidebarWidth: sidebarRect.width,
            collapseWidth: collapseRect.width,
            collapseVisible: collapseComputed.display !== "none" && collapseRect.width > 0,
            toggleDisplay: toggleComputed ? toggleComputed.display : null,
            toolsRowBottom: toolsRect.bottom,
            collapseTop: collapseRect.top,
            isUnderneathTools: collapseRect.top >= toolsRect.bottom - 2,
            isFullWidth: Math.abs(collapseRect.width - (sidebarRect.width - 32)) < 15 || collapseRect.width > (sidebarRect.width * 0.75),
            userIconOnly: userBtn ? userBtn.querySelector("span")?.offsetParent === null : true,
            userBtnWidth: userRect ? userRect.width : 0,
            userBtnHeight: userRect ? userRect.height : 0
        };
    });

    console.log("Desktop sidebar layout details:", desktopInfo);

    if (!desktopInfo.collapseVisible) {
        throw new Error("FAIL: Collapse button should be visible on desktop!");
    }
    if (!desktopInfo.isUnderneathTools) {
        throw new Error(`FAIL: Collapse button top (${desktopInfo.collapseTop}) should be underneath tools row bottom (${desktopInfo.toolsRowBottom})!`);
    }
    if (!desktopInfo.isFullWidth) {
        throw new Error(`FAIL: Collapse button width (${desktopInfo.collapseWidth}) should fill the sidebar (${desktopInfo.sidebarWidth})!`);
    }
    console.log("✓ Desktop collapse button is full width and positioned underneath profile, notification & theme buttons!");

    // Test clicking collapse button on desktop
    await page.click("#adminSidebarCollapse");
    await page.waitForTimeout(300);

    const isCollapsed = await page.evaluate(() => {
        const layout = document.getElementById("adminLayout");
        return layout.classList.contains("sidebar-collapsed");
    });
    console.log("Desktop sidebar collapsed after click:", isCollapsed);
    if (!isCollapsed) {
        throw new Error("FAIL: Sidebar did not toggle to collapsed!");
    }

    // ----------------------------------------------------
    // Test 2: Mobile Navbar (360x740, 375x812, 412x915)
    // ----------------------------------------------------
    const mobileWidths = [360, 375, 412];
    for (const width of mobileWidths) {
        console.log(`\n--- Test 2: Mobile Navbar Toggle Visibility at ${width}px width ---`);
        await page.setViewportSize({ width, height: 750 });
        await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });

        const navToggleInfo = await page.evaluate(() => {
            const toggle = document.getElementById("navToggle");
            const navMenu = document.getElementById("navMenu");
            const brand = document.querySelector(".brand");
            const navActions = document.querySelector(".nav-actions");
            const navInner = document.querySelector(".nav-inner");

            if (!toggle) return { error: "navToggle not found" };

            const rect = toggle.getBoundingClientRect();
            const computed = window.getComputedStyle(toggle);
            const bodyScrollWidth = document.body.scrollWidth;
            const clientWidth = document.documentElement.clientWidth;

            return {
                display: computed.display,
                visibility: computed.visibility,
                opacity: computed.opacity,
                rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                },
                inViewport: rect.x >= 0 && (rect.x + rect.width) <= window.innerWidth,
                bodyOverflow: bodyScrollWidth > clientWidth,
                bodyScrollWidth,
                clientWidth
            };
        });

        console.log(`Mobile ${width}px navToggle info:`, navToggleInfo);

        if (navToggleInfo.display === "none") {
            throw new Error(`FAIL: navToggle has display: none at ${width}px!`);
        }
        if (navToggleInfo.rect.width === 0 || navToggleInfo.rect.height === 0) {
            throw new Error(`FAIL: navToggle has 0 size at ${width}px!`);
        }
        if (!navToggleInfo.inViewport) {
            throw new Error(`FAIL: navToggle is OUT OF VIEWPORT at ${width}px! (x=${navToggleInfo.rect.x}, width=${navToggleInfo.rect.width}, windowWidth=${width})`);
        }
        console.log(`✓ navToggle is clearly visible and within viewport at ${width}px!`);

        // Click navToggle to test opening mobile nav menu
        await page.click("#navToggle");
        await page.waitForTimeout(250);

        const menuOpen = await page.evaluate(() => {
            const navbar = document.getElementById("navbar");
            const navMenu = document.getElementById("navMenu");
            return navbar.classList.contains("open") && window.getComputedStyle(navMenu).display === "flex";
        });
        console.log(`Mobile nav menu open state at ${width}px:`, menuOpen);
        if (!menuOpen) {
            throw new Error(`FAIL: navMenu did not open on toggle click at ${width}px!`);
        }
        console.log(`✓ Mobile navMenu opened successfully!`);
    }

    // ----------------------------------------------------
    // Test 3: Mobile Admin Sidebar (375x812)
    // ----------------------------------------------------
    console.log("\n--- Test 3: Mobile Admin Sidebar (375x812) ---");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });

    const mobileAdminInfo = await page.evaluate(() => {
        const toggle = document.getElementById("adminSidebarToggle");
        const collapse = document.getElementById("adminSidebarCollapse");
        const userBtn = document.getElementById("adminUserName");
        const notifBtn = document.getElementById("headerNotificationBtn");

        const toggleComputed = toggle ? window.getComputedStyle(toggle) : null;
        const collapseComputed = collapse ? window.getComputedStyle(collapse) : null;
        const toggleRect = toggle ? toggle.getBoundingClientRect() : null;

        return {
            toggleDisplay: toggleComputed ? toggleComputed.display : null,
            toggleWidth: toggleRect ? toggleRect.width : 0,
            toggleHeight: toggleRect ? toggleRect.height : 0,
            collapseDisplay: collapseComputed ? collapseComputed.display : null,
            isCollapseHidden: collapseComputed ? collapseComputed.display === "none" : true,
            isToggleVisible: toggleComputed ? toggleComputed.display !== "none" && toggleRect.width > 0 : false
        };
    });

    console.log("Mobile admin info:", mobileAdminInfo);

    if (!mobileAdminInfo.isToggleVisible) {
        throw new Error("FAIL: adminSidebarToggle must be visible on mobile!");
    }
    if (!mobileAdminInfo.isCollapseHidden) {
        throw new Error("FAIL: adminSidebarCollapse must be hidden on mobile!");
    }
    console.log("✓ Mobile admin toggle is visible and collapse button is hidden as required!");

    // Open sidebar on mobile
    await page.click("#adminSidebarToggle");
    await page.waitForTimeout(300);

    const mobileDrawerInfo = await page.evaluate(() => {
        const layout = document.getElementById("adminLayout");
        const sidebar = document.getElementById("adminSidebar");
        const footer = document.querySelector(".admin-sidebar-footer");
        const logout = document.querySelector(".admin-sidebar-logout");

        const sidebarRect = sidebar.getBoundingClientRect();
        const logoutRect = logout.getBoundingClientRect();
        const logoutComputed = window.getComputedStyle(logout);

        return {
            isOpen: layout.classList.contains("sidebar-open"),
            sidebarX: sidebarRect.x,
            logoutVisible: logoutComputed.display !== "none" && logoutRect.height > 0,
            logoutText: logout.innerText.trim()
        };
    });

    console.log("Mobile admin drawer info:", mobileDrawerInfo);
    if (!mobileDrawerInfo.isOpen) {
        throw new Error("FAIL: Admin layout sidebar-open not set!");
    }
    if (!mobileDrawerInfo.logoutVisible) {
        throw new Error("FAIL: Logout button not visible in mobile drawer!");
    }
    console.log("✓ Mobile admin drawer opened, logout button is visible:", mobileDrawerInfo.logoutText);

    await browser.close();
    console.log("\n==========================================");
    console.log("ALL VISUAL AND LAYOUT CHECKS PASSED 100%!");
    console.log("==========================================");
}

testLayout().catch(err => {
    console.error("Test failed with error:", err);
    process.exit(1);
});
