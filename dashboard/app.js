// Static dashboard scaffold. It intentionally sends no commands and stores no credentials.
// Add API calls only after backend authentication and authorization are implemented.
"use strict";
document.addEventListener("DOMContentLoaded", () => {
  const label = document.getElementById("connection-label");
  const notice = document.getElementById("setup-notice");
  if (label) label.textContent = "Backend not configured";
  document.querySelectorAll(".device-card button").forEach((button) => {
    button.disabled = true;
    button.addEventListener("click", (event) => event.preventDefault());
  });
  if (notice) notice.setAttribute("aria-live", "polite");
});