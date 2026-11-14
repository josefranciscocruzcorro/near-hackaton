# ADR-0004 — Agente IA (DeepSeek) propone, motor de políticas determinista decide

- Estado: Aceptado · Fecha: 2026-11-13

## Contexto
Un LLM con acceso a dinero es vulnerable a prompt injection (una factura maliciosa puede contener instrucciones). Los tracks Autonomous Business y AI Security & Defense premian exactamente este equilibrio.

## Decisión
- **Proveedor:** DeepSeek, API compatible con OpenAI (`https://api.deepseek.com/chat/completions`), salida JSON (`response_format: json_object`). Modelos configurables: `deepseek-flash` (extracción de facturas) y `deepseek-v4-pro` (plan de pagos). Clave en `DEEPSEEK_API_KEY` (nunca en el repo).
- **El LLM sólo propone.** Sus salidas pasan por validación estricta:
  - Sólo se aceptan IDs de facturas que se le entregaron; cualquier otro se descarta y se audita.
  - Nunca puede crear beneficiarios ni cambiar direcciones de pago.
  - Montos y destinos se toman de la base de datos, no del texto del LLM.
- **Motor de políticas determinista** (código puro, 100 % cubierto por pruebas unitarias) evalúa cada pago propuesto → `Allow | RequireApproval | Block` con razones legibles:
  - interruptor del agente, beneficiario en lista blanca, máximo por pago, límite diario y mensual, presupuesto por categoría, reserva mínima de tesorería, enfriamiento de beneficiario nuevo o con dirección cambiada, umbral de aprobación humana, y factura con datos de pago distintos a los registrados (señal de fraude BEC).
- **Extracción de facturas:** si los datos de pago del documento difieren de los registrados, se marca `PaymentDetailsMismatch` y la factura no puede pagarse automáticamente.
- **Trazabilidad:** cada ejecución del agente guarda modelo, tokens, razonamiento y decisiones en `AgentRun` + `AuditEvent` (append-only).

## Consecuencias
- Se puede demostrar un ataque de inyección bloqueado de forma reproducible.
- Las pruebas usan un cliente LLM falso; una suite marcada `LiveAI` ejecuta escenarios reales contra DeepSeek cuando hay clave.
