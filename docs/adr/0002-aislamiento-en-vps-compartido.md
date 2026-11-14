# ADR-0002 — Aislamiento en VPS compartido

- Estado: Propuesto (se confirma con la auditoría del VPS) · Fecha: 2026-11-13

## Contexto
El VPS ya ejecuta otros servicios. Cualquier colisión de nombre, red, volumen o puerto puede romper producción ajena.

## Decisión
- `name: nearhk` en el compose → todos los recursos quedan prefijados (`nearhk-api-1`, `nearhk_pgdata`, …).
- Red interna propia `nearhk_internal` con subred explícita elegida fuera de las ocupadas (según auditoría).
- Sólo nginx publica puerto; Postgres, PgBouncer, API y Hangfire **no** publican puertos al host.
- Si ya existe un proxy inverso en el host (puertos 80/443 ocupados), nuestro nginx se publica en `127.0.0.1:<puerto libre>` y el proxy existente enruta el subdominio hacia él; no se toca su configuración sin aprobación.
- Límites de memoria/CPU por servicio para no degradar a los vecinos.

## Valores confirmados por la auditoría (2026-11-13)
- Contenedores `nearhk_api`, `nearhk_postgres`, `nearhk_pgbouncer`, `nearhk_nginx`, siguiendo el patrón `<p>_servicio` del equipo.
- Red `nearhk_net` con subred `10.88.0.0/24`. Volúmenes `nearhk_postgres_data` y `nearhk_dpkeys`.
- Publicación `127.0.0.1:32080 → nearhk_nginx:80`.
- El nginx del host recibe un **nuevo** archivo `/etc/nginx/sites-available/near.gesco.ec` con proxy a 32080 + certbot. No se edita ningún bloque existente; siempre `nginx -t` antes de recargar.
- Código en `/root/nearhk`.
