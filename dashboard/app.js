"use strict";
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const apiInput = document.getElementById("api-base");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const authMessage = document.getElementById("auth-message");
  const loginButton = document.getElementById("login-button");
  const logoutButton = document.getElementById("logout-button");
  const refreshButton = document.getElementById("refresh-button");
  const connectionLabel = document.getElementById("connection-label");
  const connectionDot = document.getElementById("connection-dot");
  let token = null;
  let apiBase = "";
  let busy = false;

  const configuredBase = window.REMOTE_LOCK_CONFIG && window.REMOTE_LOCK_CONFIG.apiBase;
  const savedBase = sessionStorage.getItem("remoteLockApiBase");
  apiInput.value = configuredBase || savedBase || "";

  function setMessage(message, isError = false) {
    authMessage.textContent = message;
    authMessage.classList.toggle("error", isError);
  }
  function setConnection(label, connected) {
    connectionLabel.textContent = label;
    connectionDot.classList.toggle("online", Boolean(connected));
  }
  function setButtonsEnabled(enabled) {
    document.querySelectorAll("[data-state]").forEach(button => {
      button.disabled = !enabled || busy;
    });
    refreshButton.disabled = !enabled || busy;
  }
  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  }
  function renderDevices(payload) {
    renderAudit(payload.audit || []);
    for (const id of ["PC", "Server"]) {
      const device = payload.devices && payload.devices[id];
      const card = document.querySelector('[data-device="' + id + '"]');
      if (!device || !card) continue;
      card.querySelector('[data-field="connection"]').textContent = device.connected ? "Online" : "Offline";
      card.querySelector('[data-field="connection-text"]').textContent = device.connected ? "Connected" : "Not connected";
      card.querySelector('[data-field="desired"]').textContent = device.desiredState || "Unknown";
      card.querySelector('[data-field="reported"]').textContent = device.reportedState || "Unknown";
      card.querySelector('[data-field="last-seen"]').textContent = formatDate(device.lastSeen);
    }
  }
  function renderAudit(entries) {
    const list = document.getElementById("audit-list");
    list.replaceChildren();
    const recent = entries.slice(-10).reverse();
    if (!recent.length) {
      const item = document.createElement("li");
      item.className = "audit-empty";
      item.textContent = "No saved state requests yet.";
      list.append(item);
      return;
    }
    for (const entry of recent) {
      const item = document.createElement("li");
      item.className = "audit-item";
      const main = document.createElement("div");
      main.className = "audit-main";
      const title = document.createElement("strong");
      title.textContent = (entry.device || "Device") + " · " + (entry.desiredState || "Unknown");
      const detail = document.createElement("span");
      detail.textContent = (entry.actor || "Unknown user") + " requested state · " + formatDate(entry.at);
      main.append(title, detail);
      const badge = document.createElement("span");
      badge.className = "audit-badge";
      badge.textContent = "REQUESTED";
      item.append(main, badge);
      list.append(item);
    }
  }
  async function api(path, options = {}) {
    const response = await fetch(apiBase + path, {
      method: options.method || "GET",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { "Authorization": "Bearer " + token } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      mode: "cors",
      credentials: "omit"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || ("Request failed (" + response.status + ")"));
    return data;
  }
  function validateApiBase(value) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error("Enter the HTTPS address of your private API."); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("The API address must be HTTPS, without embedded credentials, query strings, or fragments.");
    }
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  }
  async function refreshDevices() {
    const payload = await api("/api/devices");
    renderDevices(payload);
    setConnection("Authenticated · enforcement disabled", true);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    loginButton.disabled = true;
    try {
      apiBase = validateApiBase(apiInput.value.trim()).replace(/\/$/, "");
      apiInput.value = apiBase;
      setMessage("Connecting to private API…");
      const result = await api("/api/login", {
        method: "POST",
        body: { username: usernameInput.value.trim(), password: passwordInput.value }
      });
      token = result.token;
      passwordInput.value = "";
      sessionStorage.setItem("remoteLockApiBase", apiBase);
      logoutButton.hidden = false;
      setButtonsEnabled(true);
      await refreshDevices();
      setMessage("Signed in as " + result.username + ". Requests only save desired state; no device is being locked yet.");
    } catch (error) {
      token = null;
      setButtonsEnabled(false);
      logoutButton.hidden = true;
      setConnection("Not connected", false);
      setMessage(error.message, true);
    } finally {
      busy = false;
      loginButton.disabled = false;
      setButtonsEnabled(Boolean(token));
    }
  });

  refreshButton.addEventListener("click", async () => {
    if (!token || busy) return;
    busy = true;
    setButtonsEnabled(false);
    try {
      await refreshDevices();
      setMessage("Device status and recent activity refreshed.");
    } catch (error) {
      if (/Authentication required/i.test(error.message)) token = null;
      setMessage(error.message, true);
      if (!token) {
        logoutButton.hidden = true;
        setConnection("Session expired", false);
      }
    } finally {
      busy = false;
      setButtonsEnabled(Boolean(token));
    }
  });

  document.querySelectorAll("[data-state]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!token || busy) return;
      const card = button.closest("[data-device]");
      const device = card && card.dataset.device;
      const desiredState = button.dataset.state;
      if (!device || !["PC", "Server"].includes(device)) return;
      const confirmed = window.confirm("Save " + desiredState + " as the desired state for " + device + "? This does not lock or unlock Windows.");
      if (!confirmed) return;
      busy = true;
      setButtonsEnabled(false);
      try {
        const result = await api("/api/devices/" + device + "/state", {
          method: "POST",
          body: { desiredState }
        });
        await refreshDevices();
        setMessage(result.message || "Desired state saved. Enforcement remains disabled.");
      } catch (error) {
        if (/Authentication required/i.test(error.message)) token = null;
        setMessage(error.message, true);
        if (!token) {
          setButtonsEnabled(false);
          logoutButton.hidden = true;
          setConnection("Session expired", false);
        }
      } finally {
        busy = false;
        setButtonsEnabled(Boolean(token));
      }
    });
  });

  logoutButton.addEventListener("click", async () => {
    const currentToken = token;
    token = null;
    setButtonsEnabled(false);
    logoutButton.hidden = true;
    try {
      if (currentToken && apiBase) {
        await fetch(apiBase + "/api/logout", {
          method: "POST",
          headers: { "Authorization": "Bearer " + currentToken },
          mode: "cors",
          credentials: "omit",
          cache: "no-store"
        });
      }
    } finally {
      setConnection("Signed out", false);
      setMessage("Signed out. Your session token was held only in page memory.");
    }
  });

  setButtonsEnabled(false);
  setConnection("Not connected", false);
});