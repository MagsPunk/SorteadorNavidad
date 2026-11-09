# 🎄 Intercambio navideño privado — prototipo de cinco personas

Sitio familiar en español, backend Cloudflare Workers y base persistente Cloudflare D1.
El repositorio **no incluye asignaciones, contraseñas reales ni claves de cifrado**.

## Funciones implementadas

- Demostración con **Ana, Carlos, Sofía, Diego y Lucía**.
- Organizador crea contraseñas aleatorias una sola vez y las conserva fuera de GitHub.
- El organizador puede activar el sorteo una sola vez, pero **no recibe una lista de resultados**.
- Motor aleatorio que garantiza que nadie se regala a sí mismo y que todos reciben una vez.
- Códigos personales aleatorios de 144 bits, verificados mediante HMAC-SHA256 con sal individual y una clave privada del servidor (no se guardan contraseñas originales). Este método depende de que los códigos sean aleatorios y largos, no permite contraseñas débiles elegidas por usuarios y evita superar el límite de CPU del plan gratuito con PBKDF2.
- Resultados cifrados con AES-256-GCM; la clave se establece como secreto del Worker, nunca en GitHub.
- Inicio de sesión por participante con cookie HttpOnly, Secure, SameSite=Strict y vencimiento de cuatro horas.
- Consultar `/api/result` devuelve **solo** el resultado de la sesión iniciada.
- Protección básica contra solicitudes de otros orígenes e intentos repetidos de autenticación.
- La base de datos sobrevive a recargas y a nuevas versiones del sitio.

## Publicar con Cloudflare (necesita una cuenta de Cloudflare)

> GitHub guarda el código. **GitHub Pages por sí solo no puede alojar esta API ni la base de datos**.
> La página pública y el backend se sirven juntos desde una URL de Cloudflare Workers.

1. Instala Node.js 20+ y ejecuta `npm install` dentro de la carpeta del proyecto.
2. Ejecuta `npx wrangler login` para vincular tu cuenta de Cloudflare.
3. Ejecuta `npx wrangler d1 create intercambio-navidad`.
4. Copia el `database_id` que devuelve a `wrangler.jsonc`, sustituyendo `REEMPLAZAR_CON_ID_DE_TU_D1`.
5. Crea las tablas con `npm run db:remote`.
6. Genera tres secretos privados, **sin publicarlos en GitHub**:
   - `ADMIN_TOKEN`: contraseña aleatoria de al menos 24 caracteres.
   - `SESSION_SECRET`: cadena aleatoria de al menos 32 caracteres.
   - `ENCRYPTION_KEY`: cadena Base64 de **32 bytes aleatorios**. Se puede generar localmente con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
7. Agrega cada secreto con comandos separados: `npx wrangler secret put ADMIN_TOKEN`, `npx wrangler secret put SESSION_SECRET` y `npx wrangler secret put ENCRYPTION_KEY`. El comando solicita cada valor de forma interactiva.
8. Ejecuta `npm run deploy` y abre la URL `https://intercambio-navidad-familiar.<tu-subdominio>.workers.dev` que devuelva el comando.
9. Abre `/admin.html` en esa misma URL, introduce el `ADMIN_TOKEN` y pulsa **Generar participantes y contraseñas**.
10. **Copia inmediatamente las cinco contraseñas**: no se almacenan en texto claro y no pueden recuperarse.
11. Cuando estés listo, pulsa **Realizar y cerrar sorteo**. Es irreversible desde la interfaz de administración.
12. Entrega a cada familiar solo su contraseña y comparte la página principal.

### Desarrollo local

1. Copia `.dev.vars.example` a `.dev.vars` y reemplaza los valores con secretos locales aleatorios.
2. Prepara la base local: `npm run db:local`.
3. Abre la página desde `npm run dev` (la dirección la muestra Wrangler).
4. Ejecuta `npm test` para comprobar el motor de asignaciones.

## Limitaciones conocidas y próximas etapas

- **No hay anonimato absoluto frente al organizador:** conoce las cinco contraseñas y podría iniciar sesión como los demás. También puede administrar su infraestructura Cloudflare. Solo evitamos que haya una interfaz administrativa para ver el mapa de asignaciones.
- Esta versión solo permite cinco usuarios ficticios y la regla básica de **no regalarse a sí mismo**. Las reglas secretas de familias, parejas u otras exclusiones se agregarán en otra etapa y se validarán en el servidor.
- Una vez creado el sorteo, no se repite por actualizar el navegador, reiniciar el servidor ni cambiar el HTML. Para realizar otro intercambio deberá crearse otro entorno/base de datos.
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
| POST | `/api/admin/draw` | Token administrador; una sola vez |

## Nota de seguridad

No añadas un endpoint que devuelva todas las asignaciones. No pongas contraseñas, reglas privadas ni claves en `public/`, variables de frontend o en el repositorio. La implementación no debe considerarse auditada profesionalmente; realiza las pruebas antes de enviar invitaciones reales.
