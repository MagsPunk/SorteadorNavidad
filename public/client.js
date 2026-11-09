const $ = id => document.getElementById(id);
let authenticated = false;

function message(element, text, isError = false) {
  element.hidden = false;
  element.textContent = text;
  element.classList.toggle("error", isError);
}

async function api(path, opts = {}) {
  const resp = await fetch(path, { cache: "no-store", credentials: "same-origin", ...opts });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "No se pudo contactar al servidor.");
  return data;
}

function hideResult() {
  $("recipient-name").textContent = "";
  $("revealed").hidden = true;
  $("sealed").hidden = false;
  $("reveal-notice").hidden = true;
}

function showLoggedIn(name) {
  authenticated = true;
  hideResult();
  $("user-name").textContent = name;
  $("login-section").hidden = true;
  $("reveal-section").hidden = false;
}

function showLoggedOut() {
  authenticated = false;
  hideResult();
  $("reveal-section").hidden = true;
  $("login-section").hidden = false;
  $("password").value = "";
}

async function start() {
  try {
    const state = await api("/api/status");
    if (!state.initialized) {
      message($("notice"), "El intercambio todavía está en preparación. Regresa pronto.");
      return;
    }
    $("participant").replaceChildren(new Option("Selecciona tu nombre", ""));
    for (const p of state.participants) $("participant").add(new Option(p.name, String(p.id)));
    $("login-form").hidden = false;
    if (state.drawn) $("notice").hidden = true;
    else message($("notice"), "El organizador todavía no ha confirmado el sorteo.");
    try {
      const me = await api("/api/me");
      showLoggedIn(me.name);
    } catch { /* No hay sesión: presentar formulario. */ }
  } catch {
    message($("notice"), "No fue posible conectar con el servidor. Comprueba que la aplicación esté publicada.", true);
  }
}

$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const button = $("login-button");
  button.disabled = true;
  try {
    const person = Number($("participant").value);
    const data = await api("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId: person, password: $("password").value }),
    });
    $("password").value = "";
    showLoggedIn(data.name);
  } catch(err) { message($("notice"), err.message, true); }
  finally { button.disabled = false; }
});

$("reveal-button").addEventListener("click", async () => {
  const button = $("reveal-button");
  button.disabled = true;
  try {
    const result = await api("/api/result");
    $("recipient-name").textContent = result.recipient;
    $("sealed").hidden = true;
    $("revealed").hidden = false;
    $("reveal-notice").hidden = true;
  } catch(err) { message($("reveal-notice"), err.message, true); }
  finally { button.disabled = false; }
});

$("hide-button").addEventListener("click", hideResult);
$("logout-button").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); }
  catch { /* Limpiar la vista aunque falle la conexión. */ }
  showLoggedOut();
});

// Reducir el riesgo de mostrar un resultado al dejar el dispositivo desatendido.
document.addEventListener("visibilitychange", () => { if (document.hidden && authenticated) hideResult(); });
start();
