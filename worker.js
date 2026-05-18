// ============================================================
// T212 Pie Tracker — Cloudflare Worker
// ============================================================
// CONFIG — set these two values before deploying
const T212_API_KEY = "36395632ZNVqZPsNmhFsWqKrcOLuKpFGVG|pc";   // Your Trading 212 API key
const PIE_NAME     = "Luke's-Savings";  // Exact name of the pie in T212
// ============================================================

const T212_BASE = "https://live.trading212.com/api/v0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/pie") {
        return await getPieData();
      } else if (path === "/history") {
        return await getHistory();
      } else if (path === "/cash") {
        return await getCash();
      } else {
        return json({ error: "Unknown endpoint" }, 404);
      }
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};

// ── Helpers ──────────────────────────────────────────────────

async function t212(endpoint) {
  const res = await fetch(`${T212_BASE}${endpoint}`, {
    headers: { Authorization: T212_API_KEY },
  });
  if (!res.ok) throw new Error(`T212 ${endpoint} → ${res.status}`);
  return res.json();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Find pie by name ─────────────────────────────────────────

async function findPie() {
  const pies = await t212("/equity/pies");
  const pie = pies.find(
    (p) => p.settings?.name?.toLowerCase() === PIE_NAME.toLowerCase()
  );
  if (!pie) {
    throw new Error(
      `Pie "${PIE_NAME}" not found. Available: ${pies.map((p) => p.settings?.name).join(", ")}`
    );
  }
  return pie;
}

// ── /pie — current value, invested, gain/loss ────────────────

async function getPieData() {
  const pie = await findPie();
  const detail = await t212(`/equity/pies/${pie.id}`);

  const invested = detail.settings?.initialInvestment ?? 0;
  const value    = detail.result?.value ?? 0;
  const gainLoss = value - invested;
  const gainPct  = invested > 0 ? (gainLoss / invested) * 100 : 0;

  return json({
    name:        detail.settings?.name ?? PIE_NAME,
    value:       value,
    invested:    invested,
    gainLoss:    gainLoss,
    gainPct:     gainPct,
    holdings:    (detail.instruments ?? []).map((h) => ({
      ticker:    h.ticker,
      name:      h.fullName ?? h.ticker,
      value:     h.result?.value ?? 0,
      shares:    h.ownedQuantity ?? 0,
      result:    h.result?.resultCoefficient ?? 0,
    })),
    updatedAt: new Date().toISOString(),
  });
}

// ── /history — deposits, withdrawals, dividends ───────────────

async function getHistory() {
  // Fetch up to 50 pages of transactions
  let cursor = null;
  let all = [];

  for (let i = 0; i < 50; i++) {
    const qs = cursor ? `?cursor=${cursor}&limit=50` : "?limit=50";
    const page = await t212(`/history/transactions${qs}`);
    const items = page.items ?? [];
    all = all.concat(items);
    if (!page.nextPagePath) break;
    // Extract cursor from nextPagePath
    const match = page.nextPagePath.match(/cursor=([^&]+)/);
    cursor = match ? match[1] : null;
    if (!cursor) break;
  }

  // Filter to deposit/withdrawal/dividend types only
  const relevant = all.filter((t) =>
    ["DEPOSIT", "WITHDRAWAL", "DIVIDEND"].includes(t.type)
  );

  const transactions = relevant.map((t) => ({
    id:        t.reference ?? t.id,
    type:      t.type,
    amount:    t.amount ?? 0,
    currency:  t.currency ?? "GBP",
    date:      t.dateCreated ?? t.date,
    note:      t.type === "DIVIDEND" ? (t.ticker ?? "") : "",
  }));

  // Summaries
  const totalDeposited   = transactions.filter((t) => t.type === "DEPOSIT").reduce((s, t) => s + t.amount, 0);
  const totalWithdrawn   = transactions.filter((t) => t.type === "WITHDRAWAL").reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalDividends   = transactions.filter((t) => t.type === "DIVIDEND").reduce((s, t) => s + t.amount, 0);

  return json({ transactions, totalDeposited, totalWithdrawn, totalDividends });
}

// ── /cash — account overview ──────────────────────────────────

async function getCash() {
  const cash = await t212("/equity/account/cash");
  return json(cash);
}
