# 🎄 SorteadorNavidad — intercambio familiar privado

Sitio familiar en español, backend Cloudflare Workers y base persistente Cloudflare D1.
El repositorio **no incluye asignaciones, contraseñas reales ni claves de cifrado**.

## Funciones implementadas

- Participantes personalizables (entre **2 y 50**). Si el panel detecta una lista previa de 16 personas, prepara automáticamente la incorporación de **Mónica** y **Karim** para el nuevo sorteo de 18. Antes de confirmar, revisa que estén los 18 nombres correctos.
- Organizador crea contraseñas aleatorias una sola vez y las conserva fuera de GitHub.
- El organizador puede realizar el sorteo, y también **reiniciarlo explícitamente** si la familia necesita repetirlo. El panel **nunca recibe una lista de asignaciones**.
- Motor aleatorio que garantiza que nadie se regala a sí mismo, que todos reciben una vez y que respeta las exclusiones privadas en ambos sentidos.
- Códigos personales aleatorios de 144 bits, verificados mediante HMAC-SHA256 con sal individual y una clave privada del servidor (no se guardan contraseñas originales). Este método depende de que los códigos sean aleatorios y largos, no permite contraseñas débiles elegidas por usuarios y evita superar el límite de CPU del plan gratuito con PBKDF2.
- Resultados cifrados con AES-256-GCM; la clave se establece como secreto del Worker, nunca en GitHub.
- Inicio de sesión por participante con cookie HttpOnly, Secure, SameSite=Strict y vencimiento de cuatro horas.
- Consultar `/api/result` devuelve **solo** el resultado de la sesión iniciada.
- Protección básica contra solicitudes de otros orígenes e intentos repetidos de autenticación.
- El panel permite introducir parejas excluidas, una por línea, sin incluir esas reglas en el repositorio público. Se combinan con las reglas direccionales almacenadas opcionalmente como secreto `DRAW_RESTRICTIONS` en Cloudflare.
- En D1 se guarda una copia **cifrada con AES-GCM** de las exclusiones introducidas en el panel (tabla `draw_rules`). Esta tabla se crea automáticamente si faltaba en una instalación anterior.
- La base de datos sobrevive a recargas y a nuevas versiones del sitio.

## Publicar con Cloudflare (necesita una cuenta de Cloudflare)

> GitHub guarda el código. **GitHub Pages por sí solo no puede alojar esta API ni la base de datos**.
> La página pública y el backend se sirven juntos desde una URL de Cloudflare Workers.

1. Instala Node.js 20+ y ejecuta `npm install` dentro de la carpeta del proyecto.
2. Ejecuta `npx wrangler login` para vincular tu cuenta de Cloudflare.
3. Si todavía no existe la base D1, ejecuta `npx wrangler d1 create intercambio-navidad`. Si ya la creaste, reutiliza la misma base; **no crees otra**.
4. Verifica el `database_id` de `wrangler.jsonc`, que ya quedó vinculado con la base actual.
5. Crea las tablas con `npm run db:remote`.
6. Genera tres secretos privados, **sin publicarlos en GitHub**:
   - `ADMIN_TOKEN`: contraseña aleatoria de al menos 24 caracteres.
   - `SESSION_SECRET`: cadena aleatoria de al menos 32 caracteres.
   - `ENCRYPTION_KEY`: cadena Base64 de **32 bytes aleatorios**. Se puede generar localmente con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
7. Agrega cada secreto con comandos separados: `npx wrangler secret put ADMIN_TOKEN`, `npx wrangler secret put SESSION_SECRET` y `npx wrangler secret put ENCRYPTION_KEY`. El comando solicita cada valor de forma interactiva.
8. Ejecuta `npm run deploy` y abre la URL `https://intercambio-navidad-familiar.<tu-subdominio>.workers.dev` que devuelva el comando.
9. Abre `/admin.html` en esa misma URL, introduce el `ADMIN_TOKEN` y pulsa **Generar participantes y contraseñas**.
10. **Copia inmediatamente todas las contraseñas**: no se almacenan en texto claro y no pueden recuperarse.
11. Para rehacer el intercambio con 18 participantes: ingresa a `/admin.html`, comprueba que la lista incluya los 18 nombres, pulsa **Reiniciar participantes y sorteo**, escribe `REHACER` y guarda las 18 contraseñas NUEVAS. Las anteriores dejan de funcionar.
12. Antes del sorteo, introduce las parejas que no pueden regalarse entre sí (una línea con `Persona A, Persona B` por pareja, en el campo privado). El backend bloqueará **ambas direcciones** y combinará las restricciones del secreto `DRAW_RESTRICTIONS` si existe.
13. Pulsa **Realizar y cerrar sorteo** para asignar a todos sin revelar el mapa al administrador. Si debes rehacerlo otra vez, repite el reinicio explícito: **las asignaciones ya conocidas no pueden volverse secretas**.
14. Entrega a cada familiar solo su contraseña NUEVA y comparte la página principal.

### Desarrollo local

1. Copia `.dev.vars.example` a `.dev.vars` y reemplaza los valores con secretos locales aleatorios.
2. Prepara la base local: `npm run db:local`.
3. Abre la página desde `npm run dev` (la dirección la muestra Wrangler).
4. Ejecuta `npm test` para comprobar el motor de asignaciones.

## Limitaciones conocidas y próximas etapas

- **No hay anonimato absoluto frente al organizador:** conoce las contraseñas y podría iniciar sesión como los demás. También puede administrar su infraestructura Cloudflare. Solo evitamos que haya una interfaz administrativa para ver el mapa de asignaciones.
- La lista se configura antes de crear las credenciales; las exclusiones privadas de parejas se aplican antes del sorteo y el backend valida que no haya asignaciones prohibidas. No se admiten ajustes a las asignaciones ya realizadas sin un reinicio.
- El sorteo permanece inmutable al recargar o redesplegar. Solo un **reinicio administrativo explícito** con confirmación `REHACER` elimina el sorteo anterior y genera credenciales completamente nuevas. No es necesario eliminar la base de datos.
- El bloqueo de intentos es básico para una aplicación familiar, no sustituye controles avanzados de mitigación (por ejemplo, rate limiting en el perímetro de Cloudflare y registros de auditoría).
- Antes de utilizarlo con tu familia, prueba el flujo completo sobre Workers Free; el rendimiento y la seguridad no están auditados profesionalmente.
- **No** compartas el token administrativo ni la clave de cifrado. Si se pierde `ENCRYPTION_KEY`, los resultados cifrados no podrán recuperarse.
- Las credenciales ficticias no son aptas para un evento real con nombres diferentes; en una siguiente versión se permitirá introducir la lista definitiva antes del sorteo.

## Rutas de API

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/api/status` | Público; solo nombres y estado |
| POST | `/api/login` | Participante con contraseña |
| GET | `/api/me` | Sesión de participante |
| GET | `/api/result` | Solo su propia sesión |
| POST | `/api/logout` | Participante |
| GET | `/api/admin/status` | Token administrador |
| POST | `/api/admin/initialize` | Token administrador; una sola vez |
| POST | `/api/admin/draw` | Token administrador; recibe exclusiones privadas y confirma el sorteo |
| POST | `/api/admin/reinitialize` | Token administrador; reemplaza el conjunto completo de participantes y reinicia con confirmación `REHACER` |

## Nota de seguridad

No añadas un endpoint que devuelva todas las asignaciones. No pongas contraseñas, reglas privadas ni claves en `public/`, variables de frontend o en el repositorio. La implementación no debe considerarse auditada profesionalmente; realiza las pruebas antes de enviar invitaciones reales.
