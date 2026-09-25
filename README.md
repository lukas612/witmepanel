# witmepanel

Panel de control financiero de Witme (España &amp; Panamá): ingresos, costes,
beneficio y margen mensual, con filtros por año (2025/2026) y región
(Total / España / Panamá).

Sitio estático (sin build) + [Supabase](https://supabase.com) como backend
(Postgres + Auth), desplegado en GitHub Pages.

## Arquitectura

- `index.html` (+ `assets/app.js`) — página principal / resumen ejecutivo:
  franja de "estado operativo" (clientes con aviso, vencidos +30 días,
  cumplimiento de objetivo — con enlace a su página de detalle) seguida del
  explorador de ingresos/costes/beneficio "generados" (por región,
  comparativa España/Panamá, interanual, acumulado).
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

**Actualización diaria automática.** La Edge Function
`supabase/functions/holded-daily-sync` recalcula `witme_invoiced_monthly` y
`witme_purchased_monthly` (ver más abajo) para un rango móvil de 3 meses
(mes actual + 2 anteriores) tirando en vivo de la API de Holded — el mismo
proceso descrito arriba, ahora automatizado. Se ejecuta sola cada día a las
05:17 UTC vía `pg_cron`/`pg_net` (migración
`20260924030000_witme_holded_daily_sync_cron.sql`), y también deja
constancia en `witme_data_sources` (ver "Estado de los datos"). Los meses
fuera de ese rango de 3 meses no se tocan — si hace falta recalcular un mes
más antiguo (una corrección tardía en Holded, por ejemplo) sigue siendo
manual, como antes. Para probarla a mano:
`curl -X POST https://pnprzupnqpjqgtlqkrfd.supabase.co/functions/v1/holded-daily-sync?dry_run=true -H "Authorization: Bearer <anon key>"`
(`dry_run=true` calcula y devuelve los totales sin escribir nada; sin ese
parámetro, escribe de verdad). La API key de Holded se lee de Supabase
Vault en tiempo de ejecución vía la función `public.witme_get_secret`
(`decrypted_secrets` no es accesible directamente desde una Edge Function
porque el esquema `vault` no está expuesto por PostgREST).

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

### Facturado (EBI-PAC Panamá)

`witme_panama_invoiced_monthly(year, month, currency, invoiced_total,
invoice_count, credit_count, last_pulled_at)` guarda lo realmente
facturado por la entidad de Panamá — el mismo concepto que
`witme_invoiced_monthly` para España, pero **sin tax/ITBMS** (estas
facturas de operación extranjera no llevan impuesto, así que
`invoiced_total` ya es la cifra neta) y **casi siempre en USD** (moneda de
Panamá). Primer pull real (25-sep-2026): solo hay un mes de datos —
septiembre 2026, el primer mes que la entidad usó EBI-PAC — con 9 facturas
menos 2 notas de crédito = 61.167,23 $.

**Por qué esto es manual y no un cron diario como Holded.** El Web
Service de EBI-PAC (pensado para integraciones) no tiene ningún método de
listado/consulta por fecha — solo operaciones de un documento ya conocido:
`Enviar`, `EstadoDocumento`, `Anulacion`, `DescargaXML`/`DescargaPDF`,
`FoliosRestantes`, `EnvioCorreo`, `RastreoCorreo`, `ConsultarRucDV`
(confirmado tanto por soporte de EBI-PAC como leyendo el manual de
integración en `wiki.ebi-pac.com`). La única forma de listar facturas es
el portal web humano (`factura.ebi-pac.com/invoices`), y ese portal se
autentica con una cookie de sesión de Laravel detrás de un login con
CAPTCHA — no existe ningún token de API duradero que se pueda guardar en
Vault y reutilizar como el de Holded.

**`panama.html`** (+ `assets/panama.js`) es la forma normal de forzar un
re-pull: trae los mismos pasos (login en el portal → DevTools → Network →
copiar la petición `invoices/list` como cURL) como instrucciones en la
propia página, con un textarea donde pegar la cookie/cURL y un botón
**Actualizar**. Ese botón llama a la Edge Function
`supabase/functions/ebipac-panama-sync`, que hace el trabajo real
(paginar todo el listado, agregar por mes, y escribir en
`witme_panama_invoiced_monthly` + `witme_data_sources`) — la cookie viaja
solo en esa petición y no se guarda en ningún sitio. La función comprueba
que quien llama es una de las cuentas del equipo (mismo email allowlist
que el resto de RLS) antes de hacer nada, porque a diferencia del cron de
Holded, este endpoint sí es alcanzable desde una página pública.

El navegador no puede mandar un header `Cookie` arbitrario por su cuenta
(`fetch()` lo bloquea por seguridad) — por eso la petición real a EBI-PAC
la hace la Edge Function, no el navegador del usuario.

`scripts/ebipac_pull_panama.js` sigue existiendo como alternativa desde
la terminal (pagina el listado e imprime SQL para revisar y aplicar a
mano, sin tocar Supabase directamente) — útil para depurar sin pasar por
la página. Las credenciales del portal y del Web Service están en
Supabase Vault (`ebipac_portal_user`/`ebipac_portal_pass`,
`ebipac_token_usuario`/`ebipac_token_password`) solo como referencia — no
se usan en ningún proceso automático.

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

`witme_client_invoiced_monthly` también guarda `invoice_ids` (los ids de
factura de Holded que componen ese importe, el más reciente primero, sin
contar notas de crédito) — el icono 🧾 junto a un importe en `revision.html`
y `matriz.html` abre esa factura directamente en
`https://app.holded.com/sales/revenue#open:invoice-<id>`.

`matriz.html` (+ `assets/matriz.js`) muestra la misma información como una
matriz cliente × mes (en vez de una lista para un solo mes): todas las
alertas de golpe, con filtro por tipo de aviso y/o mes, y el mismo
mecanismo de marcar como revisado (con confirmación) que comparte datos con
`revision.html`. `assets/clientData.js` centraliza la lógica de alertas que
usan ambas páginas.

### Impagados (Holded)

`impagados.html` (+ `assets/impagados.js`) lista las facturas de Holded
(España) que a día de hoy no están cobradas del todo — `status` `pending` o
`partial` — con el importe pendiente (`payments_pending` de Holded)
convertido a EUR. A diferencia de las demás tablas de Holded, que son
históricos acumulativos, `witme_unpaid_invoices` es una **foto del
momento**: la sincronización semanal (Parte 5) hace `upsert` de las que
siguen pendientes y **borra** las que ya se cobraron, se anularon o dejaron
de existir — la tabla siempre refleja el estado actual, no queda rastro de
facturas ya cobradas.

La página separa **vencidas** (pasaron su fecha de vencimiento — lo que de
verdad preocupa) de **aún no vencen** (dentro de su plazo normal de pago,
no es un problema en sí), con filtro y orden por antigüedad de vencimiento
o por importe, un filtro de "vencida hace más de N días", y tres vistas:
**detalle** (una fila por factura), **por cliente** y **por país**
(acumulado — `contact_country`/`contact_country_code` vienen del
`bill_address` del contacto en Holded). El filtro de días se aplica antes
de agrupar. El icono 🧾 abre la factura en Holded.

### Objetivos 2026

`objetivos.html` (+ `assets/objetivos.js`) muestra los objetivos 2026 de
ingresos, coste, beneficio y ROI del equipo, por mercado (España, Portugal,
Italia, Rumania, Polonia, Alemania, México) y por vertical dentro de cada
mercado (Deudas, Creditio, Instadinero, Moneya, Cdirecto — no todos los
mercados tienen todas), tal y como están en la hoja de objetivos del
equipo. `witme_targets_monthly(year, month, market, vertical, responsable,
revenue, cost, profit, roi_pct, revenue_campaigns, revenue_monetization,
roi_campaigns_pct)` guarda una fila de total por mercado (`vertical=''`) y
una fila por vertical con su responsable. Desde abril la hoja separa el
ingreso en campañas (CPA/generación de leads) y monetización (p. ej.
AdSense), con su propio ROI de campañas — antes de abril esas tres
columnas quedan en `null`. La página deja elegir un mes, un trimestre
(Q1-Q3) o el año completo acumulado (recalculando el ROI del acumulado
como beneficio/coste, no como la suma de los ROI mensuales), y tiene un
gráfico mensual/trimestral del año completo debajo de la tabla, con menú
de navegación en la cabecera ("Páginas ▾") compartido por todas las
páginas del panel (`assets/pageNav.js`).

**Son objetivos, no resultado real — no se comparan automáticamente**
contra `witme_pnl_monthly` ni ninguna otra tabla de esta app. El ingreso de
"España" en esta hoja cubre aparentemente solo las verticales con nombre
propio y es, para los mismos meses, aproximadamente la mitad del ingreso
"generado" real de España — probablemente un alcance distinto (aún sin
confirmar con el equipo). Antes de usar esta tabla para medir cumplimiento
de objetivos, verifica con el equipo qué cifra real es comparable a cada
fila.

### Resultados 2026

`resultados.html` (+ `assets/resultados.js`) muestra el beneficio
**operativo** real por mercado y vertical, tal y como lo registra el
equipo de tráfico cada semana en su propia hoja de resultados: ingresos
menos inversión publicitaria y las herramientas ligadas directamente a
esa venta (SMS, email…) — **no incluye nóminas ni el resto de gastos
fijos** (para eso está el panel "Generado"). Misma forma de tabla que
Objetivos (mismo componente de mes/trimestre/año y gráfico), en
`witme_results_monthly(year, month, market, vertical, responsable,
revenue, cost, cost_tools, profit, roi_pct, revenue_campaigns,
revenue_monetization, revenue_adsense, roi_campaigns_pct,
pct_objetivo_profit, pct_objetivo_facturacion)`.

Además de los 7 mercados de Objetivos, aquí aparecen **Colombia** y
**Brasil** (mercados nuevos, sin objetivo cargado todavía), **Affiliate**
(Everflow, Api-partners) y un mercado **Otros** que agrupa líneas sueltas
de la hoja (un acuerdo de medios, el coste de alguna herramienta) para
que el total de la página cuadre con el total real de la hoja de origen.
`pct_objetivo_profit`/`pct_objetivo_facturacion` son el cumplimiento que
ya calcula la propia hoja contra el objetivo de ESE mes concreto — solo
se muestran viendo un mes suelto, nunca sumados/promediados en un
trimestre o año (no sería válido). Esta página en sí no compara contra
Objetivos — para eso está la página "Objetivo vs Real" (ver más abajo).
Sustituir la hoja de Excel por introducir los datos aquí directamente
sigue siendo un paso pendiente, no construido todavía.

### Objetivo vs Real

`comparativa.html` (+ `assets/comparativa.js`) es el paso de comparación
pendiente que menciona la sección anterior: cruza `witme_targets_monthly`
con `witme_results_monthly` por mercado y vertical, para el mes,
trimestre o año elegido, y calcula el **% de cumplimiento** de ingresos y
de beneficio. El cumplimiento siempre se recalcula como real ÷ objetivo
**del periodo agregado elegido** (nunca sumando ni promediando los
porcentajes ya calculados mes a mes en la hoja de Resultados — eso daría
un número inválido). Las filas de Colombia, Brasil, Affiliate y Otros
(sin objetivo cargado) muestran "—" en vez de un 0% engañoso. Incluye un
gráfico Objetivo vs Real (ingresos o beneficio, por mes o trimestre) del
año completo, independiente del periodo elegido para la tabla.

### Viajes

`viajes.html` (+ `assets/viajes.js`) es la **primera parte del panel con
escritura desde el navegador** — hasta aquí todo era de solo lectura,
alimentado por la sincronización semanal. El equipo (Gisel u otro account
manager) registra aquí el gasto de cada viaje y a qué clientes se les
atribuye ingreso, para ver si el viaje fue rentable.

- `witme_trips` — el viaje: nombre/destino, fechas, responsable, estado
  (planeado/en curso/cerrado), notas.
- `witme_trip_expenses` — líneas de gasto (categoría, descripción, fecha,
  quién pagó, importe en €) — esto se teclea a mano.
- `witme_trip_clients` — qué clientes se atribuyen a un viaje y en qué
  rango de meses (por defecto el mes del viaje, ampliable si la venta
  tardó en cerrarse). **No guarda ningún importe**: el ingreso se suma
  siempre en vivo desde `witme_client_invoiced_monthly` (la misma tabla
  que usan Revisión de clientes/Matriz) para ese `contact_id` en esos
  meses, así nunca queda un número desactualizado ni duplicado. Cada
  vínculo lleva además un `client_type` (`nuevo` / `antiguo`): para los
  `antiguo` (visita a un cliente ya existente) se muestra una valoración
  que compara la media mensual del rango atribuido contra la media de
  los 3 meses naturales justo anteriores — misma fórmula y mismo umbral
  `MIN_PRIOR_ACTIVITY` (50€) que el aviso de "facturación atípica" en
  Revisión de clientes/Matriz. Para `nuevo` no aplica (no hay "antes"
  con el que comparar).

El ROI de un viaje es ingreso atribuido ÷ coste. Las 3 tablas tienen RLS
`for all` (no solo `for select`) para las mismas cuentas del resto del
panel — cualquiera de ellas puede crear, editar o borrar, sin control
de "solo puedes tocar lo tuyo" (mantenido simple a propósito; se puede
endurecer si hace falta). No hay sincronización semanal para estas tablas
porque el dato nace aquí, no en una hoja externa.

### Estado de los datos

`estado.html` (+ `assets/estado.js`) es un registro **de solo lectura**:
por cada fuente (Facturado, Comprado, Revisión de clientes, Impagados,
Objetivos, Resultados) muestra cuándo se actualizó por última vez y hasta
qué mes llegan los datos cargados (`witme_data_sources`, campos
`last_updated_at` y `covers_until_year`/`covers_until_month`, más un
`target_note` libre para anotar algo como "falta cargar Q4"). No hay
ningún botón que dispare una sincronización — de momento es solo un
registro manual: cuando se carga una sincronización real de verdad (nueva
migración con datos de Holded, o una hoja de Objetivos/Resultados), hay
que actualizar la fila correspondiente a mano (`update witme_data_sources
set last_updated_at = now(), covers_until_year = ..., covers_until_month =
... where key = '...'`). `impagados` no lleva "cubre hasta" porque es una
foto del momento (se sustituye entera en cada sincronización), no una
serie mensual.

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
