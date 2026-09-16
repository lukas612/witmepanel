# witmepanel

Panel de control financiero de Witme (España &amp; Panamá): ingresos, costes,
beneficio y margen mensual, con filtros por año (2025/2026) y región
(Total / España / Panamá).

Sitio estático (sin build) + [Supabase](https://supabase.com) como backend
(Postgres + Auth), desplegado en GitHub Pages.

## Arquitectura

- `index.html`, `assets/style.css`, `assets/app.js` — la app. Sin framework,
  sin paso de build: Chart.js y `@supabase-js` se cargan por CDN.
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
