// Manual puller for Panama invoicing from the EBI-PAC web portal.
//
// Why this is manual and not a cron job like Holded's: EBI-PAC's Web
// Service (the thing meant for API integrations) has no list/query-by-date
// method -- only single-document operations (Enviar, EstadoDocumento,
// DescargaXML/PDF, FoliosRestantes...). The only place that lists invoices
// is the human web portal (factura.ebi-pac.com/invoices), and it
// authenticates with a plain Laravel session cookie behind a CAPTCHA-gated
// login -- there is no durable token to store and no way to get a fresh
// session without a human logging in through the browser.
//
// So: whenever Panama invoicing needs a refresh, a human logs into
// https://factura.ebi-pac.com/invoices, opens DevTools -> Network, reloads
// the table, and copies the `cookie` request header from that XHR request
// (right click the request -> Copy -> Copy as cURL is easiest -- the
// Cookie header is in there). Pass it to this script and it prints ready-
// to-run SQL to refresh the affected months in witme_panama_invoiced_monthly.
//
// Usage:
//   EBIPAC_COOKIE='PHPSESSID=...; XSRF-TOKEN=...; laravel_session=...; <app-cookie>=...' \
//     node scripts/ebipac_pull_panama.js
//
// The script does NOT write to Supabase itself (no service-role key lives
// here) -- it prints SQL for a human (or Claude, via the Supabase MCP) to
// review and apply.

const COOKIE = process.env.EBIPAC_COOKIE;
if (!COOKIE) {
  console.error("Set EBIPAC_COOKIE to the portal session's Cookie header (see comment at the top of this file).");
  process.exit(1);
}

const PAGE_SIZE = 200;
const MAX_ITERS = 50;

const COLUMNS = ["issue_date", "issue_datetime", "description", "code_cat_document_type", "document_id",
  "identification_number_receptor", "business_name", "total_amount", "name", "subsidiary", "subsidiary_point", "actions"];
const ORDERABLE = new Set(["issue_date", "issue_datetime", "code_cat_document_type", "document_id", "business_name", "name"]);

// The portal's date-range picker feeds a per-column search value on
// issue_datetime (column 1) -- without it, the table silently defaults to
// a narrow recent window and hides older documents. Confirmed live: this
// was the difference between "1 month, 11 docs" and "12 months, 261 docs".
const DATE_RANGE = "2015-01-01 00:00:00 - 2035-12-31 23:59:00";

function buildUrl(start, length) {
  const params = new URLSearchParams();
  params.set("draw", "1");
  COLUMNS.forEach((c, i) => {
    params.set(`columns[${i}][data]`, c);
    params.set(`columns[${i}][name]`, "");
    params.set(`columns[${i}][searchable]`, "true");
    params.set(`columns[${i}][orderable]`, String(ORDERABLE.has(c)));
    params.set(`columns[${i}][search][value]`, c === "issue_datetime" ? DATE_RANGE : "");
    params.set(`columns[${i}][search][regex]`, "false");
  });
  params.set("order[0][column]", "0");
  params.set("order[0][dir]", "desc");
  params.set("start", String(start));
  params.set("length", String(length));
  params.set("search[value]", "");
  params.set("search[regex]", "false");
  params.set("_", String(Date.now()));
  return "https://factura.ebi-pac.com/invoices/list?" + params.toString();
}

async function fetchAll() {
  const all = [];
  let start = 0;
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const res = await fetch(buildUrl(start, PAGE_SIZE), {
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        "referer": "https://factura.ebi-pac.com/invoices",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "cookie": COOKIE,
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    const rows = json.data || [];
    if (rows.length === 0) break;
    all.push(...rows);
    console.error(`fetched start=${start} rows=${rows.length} total=${all.length}`);
    if (rows.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
    await new Promise((r) => setTimeout(r, 300));
  }
  return all;
}

function aggregate(rows) {
  const agg = new Map();
  for (const r of rows) {
    const isCredit = /cr[eé]dito/i.test(r.code_cat_document_type || "");
    const [dd, mm, yyyy] = r.issue_date.split("-").map(Number);
    const key = `${yyyy}-${mm}`;
    const cur = agg.get(key) || { year: yyyy, month: mm, total: 0, invoiceCount: 0, creditCount: 0 };
    const amount = Number(r.total_amount);
    cur.total += isCredit ? -amount : amount;
    if (isCredit) cur.creditCount++; else cur.invoiceCount++;
    agg.set(key, cur);
  }
  return [...agg.values()].sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
}

async function main() {
  const rows = await fetchAll();
  const monthly = aggregate(rows);

  console.log(`\n-- ${rows.length} documents fetched, ${monthly.length} month(s) affected.`);
  console.log("-- Currency assumed USD (Panama invoices carry no tax/ITBMS on these documents).");
  console.log("-- Review before applying -- this overwrites whichever months appear below.\n");
  for (const m of monthly) {
    console.log(
      `insert into witme_panama_invoiced_monthly (year, month, currency, invoiced_total, invoice_count, credit_count, last_pulled_at) ` +
      `values (${m.year}, ${m.month}, 'USD', ${m.total.toFixed(2)}, ${m.invoiceCount}, ${m.creditCount}, now()) ` +
      `on conflict (year, month, currency) do update set invoiced_total = excluded.invoiced_total, ` +
      `invoice_count = excluded.invoice_count, credit_count = excluded.credit_count, last_pulled_at = now();`
    );
  }
  console.log(
    `\nupdate witme_data_sources set last_updated_at = now(), covers_until_year = ${monthly[monthly.length - 1]?.year}, ` +
    `covers_until_month = ${monthly[monthly.length - 1]?.month} where key = 'facturado_panama';`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
