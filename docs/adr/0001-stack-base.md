# ADR-0001 — Stack base

- Estado: Aceptado · Fecha: 2026-11-13

## Contexto
Patrón arquitectónico estándar del equipo y requisitos del usuario.

## Decisión
- **Orquestación:** un `docker-compose.yml` base + `nginx/nginx.conf` dedicado como único punto de entrada HTTP.
- **Backend (`/backend`):** última versión estable de .NET; arquitectura limpia (Domain, Application, Infrastructure, Api); `TreatWarningsAsErrors`, analizadores .NET y `Nullable` habilitados.
- **Datos:** PostgreSQL detrás de **PgBouncer** (pool en modo `transaction`; EF Core con `No Reset On Close`/sin prepared statements de servidor según compatibilidad).
- **Jobs:** **Hangfire** con almacenamiento PostgreSQL (conexión directa a Postgres, no vía PgBouncer, por sus locks de sesión).
- **Frontend (`/frontend`):** React + TypeScript + Vite; PWA con `vite-plugin-pwa`, `registerType: 'autoUpdate'` y aviso al usuario al activarse la nueva versión.
- **Pruebas:** xUnit + Testcontainers (backend); Vitest + Testing Library (frontend); Playwright (E2E, multi-viewport) + axe.

## Consecuencias
- Hangfire y la app usan cadenas de conexión distintas (directa vs pooler) — documentado en `.env.example`.

## Versiones fijadas (2026-11-13)
- **.NET 11.0.100** (GA 2026-11-10) → `net11.0`, ASP.NET Core 11.
- **EF Core 10.0.15 + Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3** (LTS estable). El proveedor Npgsql 11 sólo existe como `rc.3`; no se usan prereleases en producción. Migrar a EF Core 11 cuando Npgsql 11 sea GA.
- Hangfire 1.8.25 + Hangfire.PostgreSql 1.21.1.
- Imágenes del equipo en el VPS: postgres:17-alpine, edoburu/pgbouncer:v1.23.1-p3, nginx:1.27-alpine.
- Frontend: React 19, Vite 8, vite-plugin-pwa 2, Tailwind 4, TanStack Query 5, React Router 8, Vitest 5, Playwright 1.65.
