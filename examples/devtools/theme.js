export function applyTheme(document, theme) {
  const value = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = value;
  try {
    document.defaultView.localStorage.setItem("wf-theme", value);
  } catch {
    /* No-storage mode still themes. */
  }
  for (const button of document.querySelectorAll(".theme-toggle")) {
    button.setAttribute("aria-pressed", String(value === "dark"));
    button.textContent = value === "dark" ? "Light mode" : "Dark mode";
  }
}
export function initializeTheme(document) {
  const window = document.defaultView;
  let theme = document.documentElement.dataset.theme;
  try {
    theme = window.localStorage.getItem("wf-theme") ?? theme;
  } catch {
    /* Use prepaint preference. */
  }
  applyTheme(document, theme);
  const listener = (event) => {
    if (event.key === "wf-theme") applyTheme(document, event.newValue);
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
