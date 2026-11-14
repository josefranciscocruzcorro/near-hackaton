# DESIGN.md — Sistema de diseño de Tesorero

## Benchmark 2026 (patrones abstraídos)

| Referencia | Patrón que tomamos |
|---|---|
| Mercury (banca) | Superficies calmadas, mucho aire, saldos grandes con tipografía tabular, color sólo para estados |
| Ramp (gasto + IA) | IA **explicable**: cada sugerencia muestra el porqué y la regla aplicada; bandeja de aprobaciones de un clic |
| Stripe Dashboard | Tablas financieras densas, chips de estado, fila clicable → panel lateral de detalle |
| Linear / Raycast | Paleta de comandos ⌘K, navegación por teclado, micro-animaciones sobrias |
| Vercel (Geist) | Escala tipográfica fija, bordes de 1px, grises neutros, modo oscuro de primera clase |

Tendencias 2026 que confirman la dirección: "calm design", layouts orientados a la siguiente tarea, transparencia radical (estado, comisiones y tiempos visibles), IA explicable en lugar de chatbots, mobile-first y accesibilidad como requisito.

## Principios
1. **Lo siguiente que hay que hacer, primero.** La vista general muestra aprobaciones pendientes y vencimientos antes que gráficos.
2. **La IA se explica.** Cada decisión del agente se presenta como una *tarjeta de razonamiento*: razón de la IA + veredicto del motor de políticas con chips (`Permitido` verde, `Requiere aprobación` ámbar, `Bloqueado` rojo) y la lista de reglas evaluadas.
3. **El dinero se ve exacto.** Montos y direcciones en fuente mono con `tabular-nums`; direcciones truncadas al medio con botón para copiar; siempre el activo y la cadena de destino.
4. **Calma.** Neutros cálidos, un solo acento, sombras mínimas y movimiento ≤ 200 ms (desactivado con `prefers-reduced-motion`).

## Tokens
- **Fuentes:** Inter Variable (UI) y JetBrains Mono (montos, direcciones, hashes), autoalojadas vía `@fontsource-variable` para que la PWA funcione sin conexión.
- **Escala:** 12 / 13 / 14 (base) / 16 / 20 / 24 / 32 / 44 px. Pesos 400/500/600.
- **Espaciado:** múltiplos de 4 px. Radio 10 px en tarjetas, 8 px en controles y 999 px en chips.
- **Color (claro / oscuro):**
  - fondo `#FAFAF9` / `#0B0B0C` · superficie `#FFFFFF` / `#141416` · borde `#E7E5E4` / `#26262A`
  - texto `#1C1917` / `#F5F5F4` · texto suave `#78716C` / `#A1A1AA`
  - acento `#0E9F6E` / `#34D399` (verde menta: dinero que se mueve)
  - éxito = acento · aviso `#B45309` / `#FBBF24` · peligro `#B91C1C` / `#F87171` · info `#1D4ED8` / `#93C5FD`
- **Contraste:** WCAG 2.2 AA mínimo, en ambos temas.

## Layout
- **≥ 1024 px:** barra lateral fija de 248 px (colapsable a iconos) + barra superior (⌘K, modo Simulación/Live, usuario y rol, tema).
- **< 1024 px:** barra superior compacta + **barra de pestañas inferior** (Inicio, Facturas, Aprobaciones con contador, Pagos, Más), como una app nativa.
- Las tablas pasan a lista de tarjetas por debajo de 768 px.
- Objetivos táctiles ≥ 44 px; anillos de foco visibles (2 px de acento con desplazamiento de 2 px).

## Componentes clave
- Tarjetas KPI en rejilla bento: saldo USDC, gasto de hoy contra el límite (barra de progreso), gasto del mes contra el límite y aprobaciones pendientes.
- Medidor de presupuestos por categoría.
- Tarjeta de razonamiento del agente (componente insignia).
- Chip de estado de pago con icono y texto, nunca sólo color.
- Panel lateral de detalle (desktop) u hoja inferior (móvil).
- Estados vacío, carga (skeleton) y error en cada vista.
- Toasts con `aria-live="polite"` y aviso de "Nueva versión instalada" de la PWA.

## Frontend notes (2026-11-13)

- **TypeScript 6.0.3**, not 7: typescript-eslint 8.72.2 (latest) declares `typescript >=4.8.4 <6.1.0`, so 6.0.3 is the newest version it supports. Revisit when typescript-eslint supports TS 7.
- **ESLint 9.39.5** (not 10): `eslint-plugin-jsx-a11y` 6.10.2 only declares support up to ESLint 9.
- Versions: React 19.3.1, Vite 8.3.8, Tailwind CSS 4.3.5 (CSS-first `@theme`), TanStack Query 5.107.1, React Router 8.5.1 (data mode, lazy routes), vite-plugin-pwa 2.0.0, Vitest 5.1.0, MSW 3.0.5, lucide-react 1.72.0.
- **Contrast adjustments (AA):** the light-theme accent `#0E9F6E` is 3.4:1 on white, so it is used for fills, meters and focus rings only; text and filled buttons use `accent-strong` `#047857` (5.5:1). Light "texto suave" is `#6F6964` instead of `#78716C` so it stays ≥ 4.5:1 on the `#F5F5F4` secondary surface. Dark theme tokens are unchanged.
- Tokens live as CSS variables (`--tz-*`) on `:root` / `.dark` and are exposed to Tailwind through `@theme inline` (`bg-surface`, `text-muted`, `text-accent-strong`, …). Type scale uses rem equivalents of 12/13/14/16/20/24/32/44 px.
- Dark mode: class on `<html>`; preference `system | light | dark` persisted in `localStorage` (`tesorero.theme`), applied before first paint by an inline script.
- Dialogs, side panel and bottom sheet use native `<dialog>` (focus trap, Escape, inert background). Toasts are an `aria-live` region rendered as a manual popover so they appear above open dialogs.
- Tables become card lists below 768 px (Bills: below 1280 px because it has seven columns).
- **Instance awareness (2026-11-14):** `GET /api/instance` is read once by a root `InstanceGate` route (cached for the session, preserved across sign-in/out). `needsSetup` sends every route to `/setup`; otherwise `/setup` redirects to `/login`. If the call fails the app falls back to the clean login (never to the demo shortcuts). Demo-account buttons and the dismissible (per browser session) `demo-banner` appear only when `demo: true`.
- **On-chain guardrails card** (Overview, only when `treasury.onChain` is present): contract + NearBlocks link, agent, max per payment, daily limit, spent-today meter and remaining today. Paused state uses the danger tone on the border, a "Paused on-chain" chip and a callout — never colour alone.
- **Users** (`/users`) is Owner-only: hidden from sidebar, "More" sheet and command palette for other roles (`NavItem.permission`); a direct URL shows a "needs Owner" state and never calls the API. Temporary passwords come from `crypto.getRandomValues` (20 chars, unambiguous alphabet, rejection sampling). 409 business rules (last Owner, self-demotion, duplicate email) are shown verbatim from `ProblemDetails.detail` inside the dialog.
- **Passwords:** shared `PasswordField` (show/hide, optional strength hint ≥ 12 chars announced with `aria-live`, optional generate/copy). Used by setup, change password, invite and reset.
- **Multi-tenant routing (ADR-0006, 2026-11-14):** `AppRouter` reads `GET /api/instance` before creating the router and picks a route tree by `kind`. `landing` (apex) → only `/` (Landing) and `/verify`; any other path redirects to `/`; no app shell, login or setup. `tenant` → the existing `InstanceGate` tree. If the lookup fails, or `kind` is missing, the app uses the tenant tree. Landing and Verify are lazy chunks, so tenants never download them.
- **Landing (apex):** an editorial page in the same tokens. The hero is always dark: a scoped `.dark` class on the hero panel, in both themes. Hero headline uses display sizes 36/56 px (landing hero only, outside the 12–44 app scale). The hero visual is a stack of reasoning cards (AI proposal → policy verdict chip) cycling every 4.2 s. It has a pause button and example selectors (WCAG 2.2.2), stays static under `prefers-reduced-motion`, is `aria-hidden`, and an sr-only caption describes it. Sections: video (EN/ES tabs, native `<video preload="none">`, fallback panel on error), how it works (5 steps, horizontal ≥ 1024 px / vertical below), two layers of guardrails, roles, signup, FAQ (`<details>`), footer. `html:has(.landing-root)` sets `scroll-padding-top: 5rem` so anchors and focused fields clear the sticky top bar. Responsive grids use `minmax(0, …)` tracks to avoid horizontal scroll at 360 px.
- **Signup form:** the subdomain is suggested from the organization name (`slugify`: accents stripped, `[a-z0-9-]`, ≤ 30) until the person edits it. Subdomain and NEAR account are checked live by `useLiveCheck` (350 ms debounce, aborts stale requests, a stale answer never validates the current value). Clearly malformed values resolve locally without calling the API. The status lines are `aria-live="polite"` with icon + text. Submit stays disabled until local validation passes, the subdomain is `available` and the NEAR account `exists`; a hint explains why. Server 400 `errors.*` show inline and clear when that field changes; 429 shows a rate-limit message. The `website` honeypot is `sr-only` + `aria-hidden` + `tabIndex=-1` + `autocomplete=off` and is sent as typed (`""` for people). Landing strings live in `i18n/landing.{en,es}.ts`, spread into the main dictionaries.
- **Verify (`/verify?token=`):** POSTs once per attempt. A ref guards against StrictMode re-running the effect, because the token is single-use. 400 → invalid/expired + link to `/#signup`; 409 → server `detail`; network/5xx → retry.
