const $ = id => document.getElementById(id);
let adminToken = "";
let savedCredentials = "";
let namesDirty = false;

$("participant-names").addEventListener("input", () => { namesDirty = true; });

function collectNames() {
  return $("participant-names").value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
}

function showCredentials(credentials) {
  savedCredentials = credentials.map(x => `${x.name}: ${x.password}`).join("\n");
  $("credentials").textContent = savedCredentials;
  $("credentials-box").hidden = false;
}

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
  $("participant-names").disabled = false;
  $("reset-button").hidden = !status.initialized;
  $("reset-warning").hidden = !status.initialized;
  $("reset-button").disabled = !status.initialized;
  $("draw-button").disabled = !status.initialized || status.drawn;
  const selector = $("remove-participant");
  $("closed-draw-actions").hidden = !status.drawn || status.participants < 3;
  selector.replaceChildren(new Option("Selecciona un participante", ""));
  for (const name of status.names ?? []) selector.add(new Option(name, name));
  clearRemovalCheck();
  if (!namesDirty && Array.isArray(status.names) && status.names.length) {
    const existing = [...status.names];
    // Si ya hay 16 nombres, completar la lista para el nuevo sorteo de 18.
    if (existing.length === 16) {
      for (const extra of ["Mónica", "Karim"]) {
        if (!existing.includes(extra)) existing.push(extra);
      }
    }
    $("participant-names").value = existing.join("\n");
  }
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
  const names = collectNames();
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
    showCredentials(data.credentials);
    message("Participantes creados. Guarda las contraseñas antes de cerrar esta página.");
    await refresh();
  } catch(err) { message(err.message, true); await refresh(); }
});

$("reset-button").addEventListener("click", async () => {
  const names = collectNames();
  if (names.length !== 18) {
    message(`Este nuevo sorteo debe tener exactamente 18 personas (hay ${names.length}).`, true);
    return;
  }
  if (!confirm("Se borrarán las asignaciones anteriores y TODAS las contraseñas quedarán inválidas. ¿Quieres continuar?")) return;
  const confirmation = prompt('Escribe REHACER para confirmar que quieres un sorteo nuevo para 18 personas:');
  if (confirmation !== "REHACER") return;
  $("reset-button").disabled = true;
  try {
    const data = await api("/api/admin/reinitialize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ names, confirmation })
    });
    showCredentials(data.credentials);
    namesDirty = false;
    message("Se han reiniciado los 18 participantes. Guarda las contraseñas nuevas antes de sortear.");
    await refresh();
  } catch(err) {
    message(err.message, true);
    await refresh();
  }
});

$("copy-button").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(savedCredentials); message("Contraseñas copiadas. Guárdalas en un lugar seguro."); }
  catch { message("No fue posible copiar automáticamente. Selecciona y copia el texto manualmente.", true); }
});

$("draw-button").addEventListener("click", async () => {
  const rawRules = $("private-exclusions").value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!rawRules.length) {
    message("Agrega las exclusiones privadas antes de sortear, una pareja por línea.", true);
    return;
  }
  const privateExclusions = rawRules.map(line => line.split(",").map(x => x.trim()));
  const participants = new Set(collectNames());
  if (privateExclusions.some(pair => pair.length !== 2 || pair.some(name => !participants.has(name)) || pair[0] === pair[1])) {
    message("Revisa las exclusiones: usa nombres exactos de la lista, separados con coma.", true);
    return;
  }
  if (!confirm("¿Confirmas el sorteo definitivo aplicando las exclusiones privadas? El resultado anterior dejará de ser válido si lo reiniciaste.")) return;
  $("draw-button").disabled = true;
  try {
    const data = await api("/api/admin/draw", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ privateExclusions }),
    });
    $("private-exclusions").value = "";
    message(`${data.message} ${data.total} participantes asignados. Ninguna asignación se muestra aquí.`);
    await refresh();
  } catch(err) { message(err.message, true); await refresh(); }
});

function clearRemovalCheck() {
  $("removal-status").textContent = "";
  $("apply-removal").hidden = true;
  $("redraw-remaining").hidden = true;
}

$("remove-participant").addEventListener("change", clearRemovalCheck);
for (const [buttonId, mode] of [
  ["check-removal", "check"], ["apply-removal", "remove"], ["redraw-remaining", "redraw"]
]) {
  $(buttonId).addEventListener("click", async () => {
    const name = $("remove-participant").value;
    clearRemovalCheck();
    if (!name) {
      $("removal-status").textContent = "Elige a quién dar de baja.";
      return;
    }
    $("remove-participant").disabled = true;
    $("check-removal").disabled = true;
    try {
      const data = await api("/api/admin/change-closed-draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, mode })
      });
      if (mode === "check") {
        $("removal-status").textContent = data.canRemoveDirectly
          ? `Se puede dar de baja a ${name} cambiando un solo destinatario y conservando las demás contraseñas.`
          : `Dar de baja a ${name} con un solo cambio rompería una regla. Resortear puede cambiar los resultados ya consultados. Las demás contraseñas seguirán vigentes.`;
        $(data.canRemoveDirectly ? "apply-removal" : "redraw-remaining").hidden = false;
      } else {
        namesDirty = false;
        await refresh();
        $("removal-status").textContent = `Baja aplicada. Sorteo cerrado con ${data.total} participantes.`;
      }
    } catch (err) {
      $("removal-status").textContent = err.message;
    } finally {
      $("remove-participant").disabled = false;
      $("check-removal").disabled = false;
    }
  });
}
