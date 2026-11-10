// Intercambio Navideño — Cloudflare Worker + D1.
// Las contraseñas y los resultados NO se exponen en el código público.
const DEMO_NAMES = ["Ana", "Carlos", "Sofía", "Diego", "Lucía"];
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_BODY = 4096;
const SESSION_SECONDS = 4 * 60 * 60;

const bytesToB64 = bytes => btoa(String.fromCharCode(...bytes));
const b64ToBytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const base64url = bytes => bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64url = text => b64ToBytes(text.replace(/-/g, "+").replace(/_/g, "/"));
const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));

function response(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}

function fail(message, status = 400) {
  return response({ error: message }, status);
}

function fixedEqual(a, b) {
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  const n = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < n; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

async function jsonBody(request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) throw new Error("Solicitud demasiado grande.");
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error("Solicitud demasiado grande.");
  return JSON.parse(raw);
}

// Los códigos personales se generan aleatoriamente (144 bits). No admitimos
// contraseñas elegidas por el usuario: su alta entropía permite verificarlas
// mediante HMAC con una clave exclusiva del servidor sin derivaciones costosas.
async function passwordHash(password, salt, env) {
  const input = encoder.encode(`navidad-credential:v1:${base64url(salt)}:${password}`);
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), input);
  return base64url(new Uint8Array(mac));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signSession(id, secret) {
  const payload = base64url(encoder.encode(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

async function sessionId(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.split(";").map(s => s.trim()).find(s => s.startsWith("navidad_session="))?.slice(16);
  if (!token || token.length > 1000) return null;
  const [payload, signature, more] = token.split(".");
  if (!payload || !signature || more) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(env.SESSION_SECRET), fromBase64url(signature), encoder.encode(payload));
    if (!valid) return null;
    const parsed = JSON.parse(decoder.decode(fromBase64url(payload)));
    if (!Number.isSafeInteger(parsed.sub) || !Number.isSafeInteger(parsed.exp) || parsed.exp < Date.now() / 1000) return null;
    return parsed.sub;
  } catch { return null; }
}

async function aesKey(env) {
  const bytes = b64ToBytes(env.ENCRYPTION_KEY);
  if (bytes.length !== 32) throw new Error("ENCRYPTION_KEY debe tener exactamente 32 bytes en Base64.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptRecipient(id, env) {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), encoder.encode(String(id)));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

async function decryptRecipient(blob, env) {
  const [iv, ciphertext, rest] = blob.split(".");
  if (!iv || !ciphertext || rest) throw new Error("Resultado cifrado inválido.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(iv) }, await aesKey(env), fromBase64url(ciphertext));
  const id = Number(decoder.decode(plain));
  if (!Number.isSafeInteger(id)) throw new Error("Destinatario inválido.");
  return id;
}

function secureRandomInt(max) {
  const limit = Math.floor(4294967296 / max) * max;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % max;
}

export function drawCircle(ids) {
  if (ids.length < 2) throw new Error("Se requieren dos o más participantes.");
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.map((id, i) => [id, shuffled[(i + 1) % shuffled.length]]);
}

// La lista opcional guardada en Cloudflare es direccional: [["A","B"]].
 // Las parejas agregadas desde el panel privado bloquean AMBAS direcciones.
export function drawWithRestrictions(people, privateRules, symmetricPairs = []) {
  const ids = people.map(person => person.id);
  const byName = new Map(people.map(person => [person.name, person.id]));
  if (ids.length < 2 || byName.size !== ids.length) return null;
  let rules = [];
  if (privateRules) {
    try { rules = JSON.parse(privateRules); }
    catch { return null; }
  }
  if (!Array.isArray(rules) || !Array.isArray(symmetricPairs) || symmetricPairs.length > 100) return null;
  const all = [...rules];
  for (const pair of symmetricPairs) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    all.push(pair, [pair[1], pair[0]]);
  }
  if (all.some(pair => !Array.isArray(pair) || pair.length !== 2 ||
    pair[0] === pair[1] || pair.some(name => typeof name !== "string" || !byName.has(name)))) return null;
  const blocked = new Set(all.map(([giver, receiver]) => `${byName.get(giver)}:${byName.get(receiver)}`));
  // Muestreo por rechazo para no favorecer alguno de los círculos válidos.
  for (let attempt = 0; attempt < 4096; attempt++) {
    const pairs = drawCircle(ids);
    if (pairs.every(([giver, receiver]) => !blocked.has(`${giver}:${receiver}`))) return pairs;
  }
  return null;
}

async function encryptPrivateRules(value, env) {
  const iv = randomBytes(12);
  const data = encoder.encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), data);
  return `${base64url(iv)}.${base64url(new Uint8Array(cipher))}`;
}

async function decryptPrivateRules(blob, env) {
  const [iv, ciphertext, extra] = blob.split(".");
  if (!iv || !ciphertext || extra) throw new Error("Reglas cifradas inválidas.");
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(iv) }, await aesKey(env), fromBase64url(ciphertext));
  const data = JSON.parse(decoder.decode(raw));
  if (!Array.isArray(data.privateExclusions)) throw new Error("Reglas cifradas inválidas.");
  return data.privateExclusions;
}

async function ensureRulesTable(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS draw_rules (id INTEGER PRIMARY KEY CHECK (id=1), rules_encrypted TEXT NOT NULL)").run();
}

async function throttle(env, request, participantId) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  // Guardar únicamente una clave HMAC, nunca la IP directamente.
  const rawKey = `${ip}:${participantId}`;
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), encoder.encode(rawKey));
  const key = base64url(new Uint8Array(mac));
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT attempts, reset_at FROM login_limits WHERE key = ?").bind(key).first();
  if (row && row.reset_at > now && row.attempts >= 8) return false;
  const reset = row && row.reset_at > now ? row.reset_at : now + 900;
  const attempts = row && row.reset_at > now ? row.attempts + 1 : 1;
  await env.DB.prepare("INSERT INTO login_limits(key, attempts, reset_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts, reset_at=excluded.reset_at")
    .bind(key, attempts, reset).run();
  return true;
}

async function authorizeAdmin(request, env) {
  const given = request.headers.get("authorization") || "";
  return env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 24 && fixedEqual(given, `Bearer ${env.ADMIN_TOKEN}`);
}

async function handleApi(request, env, path) {
  const method = request.method;
  if (!["GET", "POST"].includes(method)) return fail("Método no permitido.", 405);

  if (method === "POST") {
    // Bloqueo básico CSRF. El navegador envía Origin en solicitudes POST.
    const origin = request.headers.get("origin");
    if (origin !== new URL(request.url).origin) return fail("Origen no autorizado.", 403);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return fail("Se requiere JSON.", 415);
  }

  if (path === "/api/status" && method === "GET") {
    const people = await env.DB.prepare("SELECT id, name FROM participants ORDER BY id").all();
    const draw = await env.DB.prepare("SELECT id FROM draws WHERE id = 1").first();
    return response({ participants: people.results, initialized: people.results.length > 0, drawn: Boolean(draw) });
  }

  if (path.startsWith("/api/admin/")) {
    if (!await authorizeAdmin(request, env)) return fail("No autorizado.", 401);

    if (path === "/api/admin/status" && method === "GET") {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM participants").first();
      const draw = await env.DB.prepare("SELECT id FROM draws WHERE id = 1").first();
      const people = await env.DB.prepare("SELECT name FROM participants ORDER BY id").all();
      return response({ participants: count.n, names: people.results.map(p => p.name), initialized: count.n > 0, drawn: Boolean(draw) });
    }

    if (path === "/api/admin/initialize" && method === "POST") {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM participants").first();
      if (count.n > 0) return fail("El intercambio ya está inicializado.", 409);
      let body;
      try { body = await jsonBody(request); }
      catch { return fail("Solicitud inválida."); }
      const submittedNames = body?.names === undefined ? DEMO_NAMES : body.names;
      if (!Array.isArray(submittedNames) || submittedNames.length < 2 || submittedNames.length > 50 ||
          submittedNames.some(name => typeof name !== "string")) {
        return fail("Ingresa entre 2 y 50 nombres.");
      }
      const names = submittedNames.map(name => name.normalize("NFC").trim());
      if (names.some(name => !/^[\p{L}][\p{L}\p{M}'’-]{0,39}$/u.test(name)) ||
          new Set(names.map(name => name.toLocaleLowerCase("es"))).size !== names.length) {
        return fail("Escribe un primer nombre por línea, sin duplicados.");
      }
      const created = [];
      const statements = [];
      for (const name of names) {
        const password = base64url(randomBytes(18));
        const salt = randomBytes(16);
        const hash = await passwordHash(password, salt, env);
        created.push({ name, password });
        // The first insert checks again inside the atomic batch.
        const sql = statements.length === 0
          ? "INSERT INTO participants(name, password_salt, password_hash) VALUES (CASE WHEN NOT EXISTS (SELECT 1 FROM participants) THEN ? END, ?, ?)"
          : "INSERT INTO participants(name, password_salt, password_hash) VALUES (?, ?, ?)";
        statements.push(env.DB.prepare(sql).bind(name, base64url(salt), hash));
      }
      try { await env.DB.batch(statements); }
      catch { return fail("No se pudo inicializar. Comprueba el estado de la base de datos.", 409); }
      return response({ message: "Guarda estas contraseñas ahora. No podrán recuperarse.", credentials: created }, 201);
    }

    if (path === "/api/admin/reinitialize" && method === "POST") {
      let body;
      try { body = await jsonBody(request); }
      catch { return fail("Solicitud inválida."); }
      if (body?.confirmation !== "REHACER" || !Array.isArray(body?.names) ||
          body.names.length < 2 || body.names.length > 50 ||
          body.names.some(name => typeof name !== "string")) return fail("Confirmación o nombres inválidos.");
      const names = body.names.map(name => name.normalize("NFC").trim());
      if (names.some(name => !/^[\p{L}][\p{L}\p{M}'’-]{0,39}$/u.test(name)) ||
          new Set(names.map(name => name.toLocaleLowerCase("es"))).size !== names.length) {
        return fail("Revisa los nombres; no pueden repetirse.");
      }
      // Reinicio atómico: invalida contraseñas, sesiones, resultados y sorteos anteriores.
      // El AUTOINCREMENT de participants NO se reinicia, así que los ID de cookies viejas no se reutilizan.
      const created = [], statements = [
        env.DB.prepare("DELETE FROM assignments"),
        env.DB.prepare("DELETE FROM draws"),
        env.DB.prepare("DELETE FROM login_limits"),
        env.DB.prepare("DELETE FROM participants")
      ];
      for (const name of names) {
        const password = base64url(randomBytes(18));
        const salt = randomBytes(16);
        const hash = await passwordHash(password, salt, env);
        created.push({ name, password });
        statements.push(env.DB.prepare("INSERT INTO participants(name, password_salt, password_hash) VALUES (?, ?, ?)")
          .bind(name, base64url(salt), hash));
      }
      await ensureRulesTable(env);
      try { await env.DB.batch(statements); }
      catch { return fail("No se pudo reiniciar el intercambio; la base anterior no se modificó.", 409); }
      return response({ initialized: true, drawn: false, credentials: created,
        message: "Participantes reiniciados. Guarda las contraseñas nuevas: las anteriores quedaron inválidas." }, 201);
    }

    if (path === "/api/admin/draw" && method === "POST") {
      const draw = await env.DB.prepare("SELECT id FROM draws WHERE id = 1").first();
      if (draw) return fail("El sorteo ya está cerrado y no se puede repetir.", 409);
      const people = await env.DB.prepare("SELECT id, name FROM participants ORDER BY id").all();
      if (people.results.length < 2) return fail("Inicializa a los participantes primero.", 409);
      let body;
      try { body = await jsonBody(request); }
      catch { return fail("Solicitud inválida."); }
      await ensureRulesTable(env);
      const saved = await env.DB.prepare("SELECT rules_encrypted FROM draw_rules WHERE id = 1").first();
      const oldPairs = saved ? await decryptPrivateRules(saved.rules_encrypted, env) : [];
      const symmetricPairs = [...oldPairs, ...(body?.privateExclusions ?? [])];
      const pairs = drawWithRestrictions(people.results, env.DRAW_RESTRICTIONS, symmetricPairs);
      if (!pairs) return fail("No se pudo preparar un sorteo válido; revisa las reglas privadas.", 409);
      const encryptedRules = await encryptPrivateRules({ privateExclusions: symmetricPairs }, env);
      const statements = [
        env.DB.prepare("INSERT INTO draws(id, created_at) VALUES (1, datetime('now'))"),
        env.DB.prepare("INSERT INTO draw_rules(id, rules_encrypted) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET rules_encrypted=excluded.rules_encrypted").bind(encryptedRules)
      ];
      for (const [giver, receiver] of pairs) {
        statements.push(env.DB.prepare("INSERT INTO assignments(participant_id, recipient_encrypted) VALUES(?, ?)").bind(giver, await encryptRecipient(receiver, env)));
      }
      try { await env.DB.batch(statements); }
      catch { return fail("El sorteo no pudo confirmarse. Vuelve a comprobar el estado.", 409); }
      // Nunca devolver pares al administrador.
      return response({ drawn: true, total: pairs.length, message: "Sorteo realizado y cerrado." });
    }
    return fail("Ruta no encontrada.", 404);
  }

  if (path === "/api/login" && method === "POST") {
    let body;
    try { body = await jsonBody(request); }
    catch { return fail("Solicitud inválida."); }
    const id = Number(body?.participantId);
    if (!Number.isSafeInteger(id) || id < 1 || typeof body.password !== "string" || body.password.length > 256) return fail("Datos inválidos.");
    if (!await throttle(env, request, id)) return fail("Demasiados intentos. Intenta de nuevo en 15 minutos.", 429);
    const user = await env.DB.prepare("SELECT id, name, password_hash, password_salt FROM participants WHERE id = ?").bind(id).first();
    if (!user) return fail("Nombre o contraseña incorrectos.", 401);
    const candidate = await passwordHash(body.password, fromBase64url(user.password_salt), env);
    if (!fixedEqual(candidate, user.password_hash)) return fail("Nombre o contraseña incorrectos.", 401);
    const cookie = `navidad_session=${await signSession(user.id, env.SESSION_SECRET)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
    return response({ authenticated: true, name: user.name }, 200, { "set-cookie": cookie });
  }

  if (path === "/api/logout" && method === "POST") {
    return response({ ok: true }, 200, { "set-cookie": "navidad_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" });
  }

  if ((path === "/api/me" || path === "/api/result") && method === "GET") {
    const id = await sessionId(request, env);
    if (!id) return fail("Inicia sesión.", 401);
    const user = await env.DB.prepare("SELECT id, name FROM participants WHERE id = ?").bind(id).first();
    if (!user) return fail("Sesión inválida.", 401);
    if (path === "/api/me") return response({ name: user.name });
    const assignment = await env.DB.prepare("SELECT recipient_encrypted FROM assignments WHERE participant_id = ?").bind(id).first();
    if (!assignment) return fail("El sorteo todavía no está publicado.", 409);
    const recipientId = await decryptRecipient(assignment.recipient_encrypted, env);
    const recipient = await env.DB.prepare("SELECT name FROM participants WHERE id = ?").bind(recipientId).first();
    if (!recipient) return fail("Resultado no disponible.", 500);
    return response({ recipient: recipient.name });
  }
  return fail("Ruta no encontrada.", 404);
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!env.DB || !env.SESSION_SECRET || !env.ENCRYPTION_KEY || !env.ADMIN_TOKEN) return fail("Configuración del servidor incompleta.", 503);
    try { return await handleApi(request, env, pathname); }
    catch (error) {
      // No incluir detalles internos ni datos sensibles en la respuesta.
      console.error("Error interno en API", error?.name || "UnknownError");
      return fail("Error interno del servidor.", 500);
    }
  },
};
