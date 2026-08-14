// Lightweight component loader: fetches reusable HTML fragments into placeholders.
// Frontend-only utility. Express does not render these.

async function loadComponent(selector, path) {
  const element = document.querySelector(selector);
  if (!element) return;

  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load component: ${path}`);
  }

  element.innerHTML = await response.text();
}

async function loadLayout() {
  await Promise.all([
    loadComponent('#sidebar', '/components/sidebar.html'),
    loadComponent('#header', '/components/header.html'),
    loadComponent('#footer', '/components/footer.html'),
  ]);
}

window.loadComponent = loadComponent;
window.loadLayout = loadLayout;
