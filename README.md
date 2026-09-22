# witmepanel

Panel de control financiero de Witme (España &amp; Panamá): ingresos, costes,
beneficio y margen mensual, con filtros por año (2025/2026) y región
(Total / España / Panamá).

Sitio estático (sin build) + [Supabase](https://supabase.com) como backend
(Postgres + Auth), desplegado en GitHub Pages.

## Arquitectura

- `index.html` (+ `assets/app.js`) — página principal: ingresos/costes/
  beneficio "generados" (hojas de origen).
- `facturado.html` (+ `assets/facturado.js`) — página aparte con lo
  realmente **facturado** en Holded (ver más abajo). Sin framework, sin
  paso de build: Chart.js y `@supabase-js` se cargan por CDN.
- `assets/auth.js` — login/logout compartido (magic link) entre ambas
  páginas; comparten sesión porque están en el mismo origen.
- `assets/style.css` — estilos compartidos.
- `assets/config.js` — URL del proyecto Supabase y su clave pública
  (`publishable`/`anon`). Es seguro exponerla: solo puede hacer lo que las
  políticas de Row Level Security permitan.
- `supabase/migrations/` — esquema y datos semilla, aplicados con el MCP de
  Supabase (o `supabase db push` con la CLI).
- `.github/workflows/deploy-pages.yml` — publica el sitio en GitHub Pages en
  cada push a `main`.

## Datos

Los datos (ver `supabase/migrations/*_witme_pnl_seed.sql`) vienen de dos
Google Sheets de origen — el detalle completo de fuentes, supuestos y
pendientes está en el documento de contexto del proyecto:

- Tabla `witme_year_config(year, has_split, visible_months)`: por año, si
  hay desglose por país y cuántos meses se muestran (2025 = 12, 2026 = 7 —
  agosto en adelante de 2026 no tiene ingresos cerrados en la hoja).
- Tabla `witme_pnl_monthly(year, month, region, revenue, cost, revenue_usd,
  is_real)`: coste e ingreso mensual por región (`total` / `espana` /
  `panama`). Panamá guarda también `revenue_usd` (el ingreso original en
  USD, antes de convertir a EUR) para auditoría.
- Tabla `witme_fx_rates(year, month, currency_pair, rate)`: tipos de cambio
  USD→EUR usados para convertir los ingresos de Panamá (medias mensuales
  aproximadas, BCE/Bank of England — no un tipo contable oficial).

Los ingresos de España son **implícitos** (total combinado − Panamá
convertido), ya que la hoja de origen no los reporta por separado. 2025 no
tiene desglose por país en la fuente.

### Facturado (Holded) vs generado (hojas)

Todo lo anterior mide lo **generado** cada mes (devengo). Por separado,
`witme_invoiced_monthly(year, month, currency, invoiced_total, invoiced_eur,
invoice_count)` guarda lo realmente **facturado** en Holded (solo entidad
España), agregado por mes y moneda de la factura:

- `invoiced_total` es el **subtotal neto** de cada factura en su moneda
  original (sin IVA, no el total con impuestos).
- `invoiced_eur` es ese mismo importe **convertido a euros** — todas las
  facturas se expresan en € para poder sumarlas en un único número (ver
  tipos de cambio abajo). El desglose por divisa original sigue disponible
  en `invoiced_total`/`currency` para auditoría.

Es una tabla intencionadamente separada de `witme_pnl_monthly`: fecha de
factura y mes de generación casi nunca coinciden, así que no se deben
mezclar ni promediar entre sí.

El token de la API de Holded se guarda en Supabase Vault como el secreto
`holded_api_key` (creado a mano, no viene en las migraciones). Para
refrescar los datos:

1. `GET /api/v2/invoices` (paginado, `limit=200`, cabecera
   `Authorization: Bearer <token>`) — suma `subtotal` (nunca `total`, que
   lleva el IVA incluido) por `(year, month, currency)` según el campo
   `date` de cada factura.
2. `GET /api/v2/credit-notes` (mismo formato de paginación) — resta su
   `subtotal` del mismo `(year, month, currency)`: una nota de crédito
   reduce lo realmente facturado (anulaciones, correcciones).
3. Convierte a EUR con el tipo de cambio de `witme_holded_fx_rates` de ese
   año/mes (rate_eur = € por 1 unidad de la divisa); si aparece una divisa
   o mes sin tipo guardado, añádelo primero (ver fuentes abajo).

Tipos de cambio (`witme_holded_fx_rates`, año/mes/divisa → EUR por unidad,
de referencia a mediados de mes, no el tipo exacto del día de la factura):
- **dic-2023 a feb-2024**: BCE vía [Frankfurter](https://api.frankfurter.dev)
  (`USD`, `MXN`, `ZAR` — Holded aún no facturaba en `COP` esos meses).
- **mar-2024 en adelante**: la
  [currency-api de @fawazahmed0](https://github.com/fawazahmed0/exchange-api)
  (datos de origen BCE/open-source), que sí cubre `COP` — Frankfurter/BCE no
  publica esa divisa.

Contrastado contra el widget nativo "Ventas" del dashboard de Holded para
enero-marzo 2026: la diferencia queda por debajo de ~1.000€/mes (Holded
usa su propio tipo de cambio interno, no expuesto por la API — se probó
`/exchange-rates`, `/currencies`, `/company`, ninguno existe — así que un
tipo de referencia mensual del BCE es la aproximación más cercana posible
sin inventar un tipo a mano).

### Comprado y resultado (Holded)

`witme_purchased_monthly(year, month, currency, purchased_total,
purchased_eur, purchase_count)` es el mismo patrón que
`witme_invoiced_monthly` pero para **compras/costes**: suma el `subtotal`
de `GET /api/v2/purchases` menos el de `GET /api/v2/purchase-refunds`
(devoluciones/anulaciones de compra), por `(year, month, currency)` según
la fecha del documento, convertido a EUR con la misma tabla
`witme_holded_fx_rates`.

La página **Facturado y resultado (Holded)** combina ambas tablas para
mostrar un **resultado a nivel Holded/facturación** (facturado − comprado)
— una vista de rentabilidad distinta y complementaria al beneficio
"generado" del panel principal (que usa otro criterio de fecha y también
incluye Panamá).

**Importante — "Comprado" es parcial, no el coste total real.** Holded
solo expone facturas de proveedor por API — no hay endpoint de nóminas,
Seguridad Social ni asientos contables (se comprobó `/payroll`,
`/employees` (sin importes de contrato), `/accounting`, `/journal`:
ninguno da coste de personal). Contrastado contra la hoja de origen:
enero 2026 tuvo un coste total España real de 885.543€, y "Comprado"
aquí solo capta 704.823€ — faltan ~180.700€, más que solo la nómina de
ese mes (~81.400€ según la hoja), así que probablemente falte también
algún gasto fijo pagado sin factura de proveedor en Holded. El
"Resultado" de esta página es la foto de la relación con proveedores,
no el beneficio real de la empresa (para eso está el panel "Generado").

Se excluyeron 2 documentos de compra con fecha con error de tecleo en
Holded (`2075-05-03`, proveedor CEDIPSA, ~76€ cada uno — probablemente
2025) en vez de adivinar a qué mes real pertenecen; se recogerán solos en
cuanto se corrija la fecha en Holded.

### Revisión de clientes (Holded)

`revision.html` (+ `assets/revision.js`) es una página aparte para detectar,
por cliente, dos tipos de aviso a partir de `witme_client_invoiced_monthly`
(facturado por `(year, month, contact_id)`, mismo criterio de fecha/EUR que
`witme_invoiced_monthly` — factura menos notas de crédito, en €):

- **Clientes que dejaron de facturar**: tuvieron más de 50€ facturados entre
  los 3 meses anteriores al seleccionado y no tienen ninguna factura (>0€)
  en el mes seleccionado.
- **Facturación atípica**: el importe del mes seleccionado se desvía ±50% o
  más de la media de sus 3 meses anteriores (se ignoran clientes con
  importes por debajo de 200€ para evitar ruido de clientes minúsculos).

Solo se pueden revisar los meses que tienen 3 meses anteriores con datos en
`witme_client_invoiced_monthly` (la tabla guarda una ventana reciente —
actualmente 2025-10 a 2026-09, todo 2026 más los 3 meses previos que hacían
falta para poder revisar enero — no el histórico completo desde 2023; ver
Parte 4 de la sincronización semanal más abajo). Cada fila se puede marcar
como revisada; queda guardado en
`witme_client_alert_reviews` (año, mes, cliente, tipo de aviso, quién y
cuándo) y no vuelve a aparecer por defecto para ese mes — hay una casilla
"mostrar revisados" para volver a verlas. Es intencionadamente una tabla
separada, más ligera, que no reemplaza `witme_invoiced_monthly`.

### Actualizar o ampliar los datos

Añade filas a `witme_pnl_monthly` (o edita las existentes) con una nueva
migración SQL, y aplícala con el MCP de Supabase o `supabase db push`.
Pendientes conocidos (ver el documento de contexto original): conectar en
vivo a las Google Sheets en vez de datos fijos, usar tipos de cambio reales
por fecha de cobro, y añadir agosto-septiembre 2026 de Panamá cuando España
tenga también datos reales de esos meses.

## Acceso (Supabase Auth)

El panel exige iniciar sesión con enlace mágico (email OTP). Solo pueden
entrar las cuentas que:

1. Existen en `auth.users` del proyecto Supabase, **y**
2. Tienen su email en la lista de la política RLS de `witme_pnl_monthly` /
   `witme_year_config` / `witme_fx_rates` (ver la migración de esquema).

El formulario de login usa `shouldCreateUser: false`, así que nadie puede
auto-registrarse: solo entra quien ya ha sido invitado.

### Añadir un usuario

1. Crear su fila en `auth.users` (magic-link, sin contraseña) — vía el
   dashboard de Supabase (Authentication → Users → Invite) o insertando
   directamente en `auth.users` + `auth.identities`.
2. Añadir su email a los tres `in (...)` de las políticas RLS (nueva
   migración, o editar y reaplicar la existente).

## Desarrollo local

Es un sitio estático puro — basta con servirlo:

```bash
npx serve .
# o: python3 -m http.server 8000
```

No hace falta ninguna variable de entorno de build: `assets/config.js` ya
trae la URL y la clave pública del proyecto Supabase.

## Despliegue

GitHub Actions publica el contenido del repo en GitHub Pages en cada push a
`main` (`.github/workflows/deploy-pages.yml`). Solo hay que activar Pages
una vez en el repo: **Settings → Pages → Source: GitHub Actions**.
