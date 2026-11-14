# ADR-0006 — Multiempresa (tenants por subdominio) y registro verificado

- Estado: Aceptado · Fecha: 2026-11-14 · Sustituye la parte "una instancia = una organización" de ADR-0005

## Contexto
Cualquier negocio debe poder registrarse sin que despleguemos una instancia por cliente. El DNS ya resuelve `tesorero.gesco.ec` y `*.tesorero.gesco.ec` al VPS.

## Decisión
- **Una aplicación, una base de datos, aislamiento por tenant.** Cada fila de negocio (usuarios, beneficiarios, facturas, extracciones, política, ajustes, saldos, ejecuciones, pagos, auditoría) lleva `TenantId`.
  - EF Core aplica **filtros globales** por el tenant de la petición y asigna `TenantId` al guardar.
  - Una fila de otro tenant es invisible y no se puede modificar.
  - El catálogo de tokens de 1Click es global.
- **Resolución del tenant por subdominio.**
  - `slug.tesorero.gesco.ec` es el tenant `slug`.
  - `tesorero.gesco.ec` (apex) es la **landing**: no tiene tenant y sólo expone las APIs públicas de registro.
  - Los hosts fuera del dominio base (por ejemplo `near.gesco.ec` o `localhost`) usan `Tenancy:DefaultSlug` (`demo`).
- **Tenant demo** (`demo`, `IsDemo = true`): datos sembrados, botón de reinicio y modo Live prohibido. Los demás tenants son reales.
- **JWT con el claim `tid`.** Un token sólo vale en su tenant: se revalida en cada petición.
- **Clave de agente por tenant.**
  - Se genera en el servidor al crear el tenant.
  - Se guarda **cifrada con AES-256-GCM**; la clave maestra `Tenancy:KeyEncryptionKey` vive sólo en el `.env`.
  - Nunca se expone por la API.
- **Jobs de Hangfire con tenant.** Los jobs llevan `tenantId`. Los recurrentes (agente diario, seguimiento de pagos, saldos) recorren los tenants activos, cada uno en su propio scope.

## Registro (landing)
1. El formulario pide:
   - nombre de la organización y subdominio deseado (validado y con disponibilidad en vivo);
   - nombre y email del responsable;
   - **cuenta NEAR**, cuya existencia en mainnet se verifica por RPC con `view_account`;
   - idioma y aceptación de términos.

   Tiene además un campo trampa anti-bots y límite de peticiones por IP.
2. Se crea un registro pendiente con un **token de verificación de email** (32 bytes aleatorios; se guarda su SHA-256; expira en 24 h) y se envía el email de verificación.
3. Al verificar:
   - se **revalida que la cuenta NEAR existe** y que el subdominio sigue libre;
   - se crea el tenant con su clave de agente y un **token de alta** (hash; 7 días);
   - se envía un segundo email con el enlace `https://slug.tesorero.gesco.ec/setup?token=…`.
4. El alta crea el primer Owner. El email debe coincidir con el verificado.

Existencia de cuenta ≠ propiedad: probar la propiedad de la cuenta NEAR exigiría una firma con la wallet. Queda como mejora (backlog).

## Consecuencias
- Un único despliegue (`nearhklive`) sirve la landing, la demo y todos los tenants.
- `near.gesco.ec` sigue funcionando: su stack resuelve todo al tenant `demo`.
- Hace falta un **certificado comodín** `*.tesorero.gesco.ec` (DNS-01 con el TXT `_acme-challenge`). Renovarlo cada 90 días exige actualizar ese TXT (certbot con `--manual --preferred-challenges dns`).
- El email sale por un servidor SMTP configurado sólo en el `.env` del servidor.
