(() => {
    const btn = document.getElementById("headerNotificationBtn");
    const dropdown = document.getElementById("headerNotificationDropdown");
    const badge = document.getElementById("notificationBadge");
    const list = document.getElementById("notificationsList");
    const markReadBtn = document.getElementById("notifMarkAllRead");
    const wrapper = document.getElementById("navNotificationsWrapper");

    if (!btn || !dropdown || !list) return;

    const READ_KEY = "sanad_read_notifications";

    function getReadIds() {
        try {
            return JSON.parse(localStorage.getItem(READ_KEY) || "[]");
        } catch {
            return [];
        }
    }

    function saveReadIds(ids) {
        try {
            localStorage.setItem(READ_KEY, JSON.stringify(ids));
        } catch { }
    }

    function timeAgo(isoString) {
        if (!isoString) return "الآن";
        const date = new Date(isoString);
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return "الآن";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `منذ ${minutes} د`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `منذ ${hours} س`;
        const days = Math.floor(hours / 24);
        return `منذ ${days} يوم`;
    }

    function escapeHtml(text) {
        return String(text || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    let cachedNotifications = [];

    function updateBadge(unreadCount) {
        if (!badge) return;
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? "+99" : String(unreadCount);
            badge.hidden = false;
        } else {
            badge.textContent = "0";
            badge.hidden = true;
        }
    }

    function renderList(notifications) {
        const readIds = new Set(getReadIds());
        let unreadCount = 0;

        if (!notifications || notifications.length === 0) {
            list.innerHTML = `<div class="notif-empty"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>لا توجد تنبيهات جديدة</span></div>`;
            updateBadge(0);
            return;
        }

        list.innerHTML = notifications.map(notif => {
            const isRead = readIds.has(notif.id);
            if (!isRead) unreadCount += 1;

            const iconClass = notif.type === "urgent"
                ? "fa-triangle-exclamation icon-urgent"
                : notif.type === "warning"
                    ? "fa-boxes-stacked icon-warning"
                    : "fa-circle-info icon-info";

            return `
                <a href="${escapeHtml(notif.link || '#')}" class="notif-item ${isRead ? 'read' : 'unread'}" data-id="${escapeHtml(notif.id)}">
                    <span class="notif-icon"><i class="fa-solid ${iconClass}" aria-hidden="true"></i></span>
                    <div class="notif-content">
                        <strong class="notif-title">${escapeHtml(notif.title)}</strong>
                        <p class="notif-msg">${escapeHtml(notif.message)}</p>
                        <time class="notif-time">${timeAgo(notif.timestamp)}</time>
                    </div>
                </a>
            `;
        }).join("");

        updateBadge(unreadCount);
    }

    async function loadNotifications() {
        try {
            const user = JSON.parse(localStorage.getItem("sanadUser") || "null");
            if (!user) return;

            const res = await fetch("/api/notifications", { credentials: "same-origin" });
            if (!res.ok) return;
            const data = await res.json();
            cachedNotifications = Array.isArray(data.notifications) ? data.notifications : [];
            renderList(cachedNotifications);
        } catch {
            // Keep existing UI in case of offline/network issues
        }
    }

    function positionDropdown() {
        const inSidebar = btn.closest(".admin-sidebar");
        if (inSidebar) {
            const rect = btn.getBoundingClientRect();
            dropdown.style.position = "fixed";
            dropdown.style.top = (rect.bottom + 10) + "px";
            dropdown.style.left = "auto";
            dropdown.style.right = (window.innerWidth - rect.right) + "px";
        } else {
            dropdown.style.position = "";
            dropdown.style.top = "";
            dropdown.style.left = "";
            dropdown.style.right = "";
        }
    }

    function toggleDropdown() {
        const isOpen = dropdown.classList.contains("active");
        if (isOpen) {
            closeDropdown();
        } else {
            positionDropdown();
            dropdown.classList.add("active");
            dropdown.hidden = false;
            btn.setAttribute("aria-expanded", "true");
        }
    }

    function closeDropdown() {
        dropdown.classList.remove("active");
        dropdown.hidden = true;
        btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    if (markReadBtn) {
        markReadBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const allIds = cachedNotifications.map(n => n.id);
            const currentRead = new Set(getReadIds());
            allIds.forEach(id => currentRead.add(id));
            saveReadIds(Array.from(currentRead));
            renderList(cachedNotifications);
        });
    }

    list.addEventListener("click", (e) => {
        const item = e.target.closest(".notif-item");
        if (!item) return;
        const id = item.dataset.id;
        if (id) {
            const currentRead = new Set(getReadIds());
            currentRead.add(id);
            saveReadIds(Array.from(currentRead));
        }
    });

    document.addEventListener("click", (e) => {
        if (wrapper && !wrapper.contains(e.target)) {
            closeDropdown();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeDropdown();
    });

    // Ensure collapsed on start
    closeDropdown();

    // Load initial notifications
    loadNotifications();

    // Refresh every 60 seconds
    setInterval(loadNotifications, 60000);
})();
