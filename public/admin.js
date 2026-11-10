const $ = id => document.getElementById(id);
let adminToken = "";
let savedCredentials = "";

function message(text, isError = false) {
  $("admin-notice").hidden = false;
  $("admin-notice").textContent = text;
  $("admin-notice").classList.toggle("error", isError);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: { "authorization": `Bearer ${adminToken}`, ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error de servidor.");
  return data;
}

async function refresh() {
  const status = await api("/api/admin/status");
  $("admin-controls").hidden = false;
  $("admin-status").textContent = `${status.participants} participantes · ${status.drawn ? "Sorteo confirmado y bloqueado" : "Sorteo pendiente"}`;
  $("init-button").disabled = status.initialized;
  $("participant-names").disabled = status.initialized;
  $("draw-button").disabled = !status.initialized || status.drawn;
}

$("admin-form").addEventListener("submit", async e => {
  e.preventDefault();
  adminToken = $("admin-token").value.trim();
  $("admin-token").value = "";
  try {
    await refresh();
    message("Acceso administrativo verificado.");
  } catch(err) {
    adminToken = "";
    $("admin-controls").hidden = true;
    message(err.message, true);
  }
});

$("init-button").addEventListener("click", async () => {
  const names = $("participant-names").value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  if (names.length < 2) {
    message("Ingresa al menos dos nombres, uno por línea.", true);
    return;
  }
  if (!confirm(`¿Registrar a ${names.length} participantes y generar sus contraseñas? Solo se podrán generar una vez.`)) return;
  $("init-button").disabled = true;
  try {
    const data = await api("/api/admin/initialize", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ names }),
    });
    savedCredentials = data.credentials.map(x => `${x.name}: ${x.password}`).join("\n");
    $("credentials").textContent = savedCredentials;
    $("credentials-box").hidden = false;
    message("Participantes creados. Guarda las contraseñas antes de cerrar esta página.");
    await refresh();
  } catch(err) { message(err.message, true); await refresh(); }
});

$("copy-button").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(savedCredentials); message("Contraseñas copiadas. Guárdalas en un lugar seguro."); }
  catch { message("No fue posible copiar automáticamente. Selecciona y copia el texto manualmente.", true); }
});

$("draw-button").addEventListener("click", async () => {
  if (!confirm("¿Confirmas el sorteo definitivo? Una vez realizado, NO podrás volver a sortear desde este panel.")) return;
  $("draw-button").disabled = true;
  try {
    const data = await api("/api/admin/draw", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    message(`${data.message} ${data.total} participantes asignados. Ninguna asignación se muestra aquí.`);
    await refresh();
  } catch(err) { message(err.message, true); await refresh(); }
});
