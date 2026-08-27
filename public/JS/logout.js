document.querySelectorAll("[data-logout]").forEach(button => {
  button.addEventListener("click", async event => {
    event.preventDefault();
    button.classList.add("is-loading");
    button.setAttribute("aria-disabled", "true");

    try {
      const csrfResponse = await fetch("/api/auth/csrf", { headers: { Accept: "application/json" } });
      const { csrfToken } = await csrfResponse.json();
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
      });
    } finally {
      localStorage.removeItem("sanadUser");
      sessionStorage.clear();
      window.location.assign("/login?loggedOut=1");
    }
  });
});
