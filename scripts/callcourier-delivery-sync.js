/**
 * CallCourier -> Shopify "Delivery status" sync
 *
 * Shopify ka Delivery status column fulfillment events se chalta hai.
 * Ye script har shipped order ka CallCourier status uthati hai aur
 * naye events Shopify mein likh deti hai.
 *
 * Node 18+ (global fetch). Koi dependency nahi.
 *
 * Run:  node callcourier-delivery-sync.js
 */

// ---------------------------------------------------------------- config

// isi folder ki .env file parh lo (token chat mein likhne ki zaroorat nahi)
(function loadEnv() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '.env');

  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (val && !process.env[m[1]]) process.env[m[1]] = val;
  }
})();

const CFG = {
  shop: process.env.SHOPIFY_STORE || 'be6fc4-ea.myshopify.com',
  token: process.env.SHOPIFY_TOKEN, // custom app ka Admin API access token
  apiVersion: '2026-10',

  // Vercel tracker ka courier route — isi mein CallCourier credentials lagi hain
  courierApi: process.env.COURIER_API || 'https://order-tracker-sigma.vercel.app/api/courier',

  // kitne din purane orders tak dekhna hai
  days: Number(process.env.DAYS || 45),

  // 'latest' = sirf aakhri status likho (kam emails, column phir bhi sahi)
  // 'full'   = poori history likho (timeline achi lagti hai, zyada emails)
  mode: process.env.MODE || 'latest',

  // true = kuch likha nahi jayega, sirf batayega kya hota
  dryRun: process.env.DRY_RUN === '1',

  // courier API par ek saath kitni requests
  concurrency: Number(process.env.CONCURRENCY || 5),

  // testing ke liye: sirf in orders par chalo, e.g. ONLY=51640,51713
  only: (process.env.ONLY || '')
    .split(',')
    .map((s) => s.trim().replace(/^#/, ''))
    .filter(Boolean),

  // jo parcel deliver ho chuka uska status ab kabhi nahi badlega — usay
  // dobara poochhna courier par bekaar ka bojh hai. SKIP_FINAL=0 se poora
  // sweep ho jata hai (kabhi mapping badle to kaam aata hai).
  skipFinal: process.env.SKIP_FINAL !== '0',
};

// in par pahunch kar parcel ka safar khatam
const FINAL_STATUSES = new Set(['DELIVERED']);

// ------------------------------------------------------- status mapping

// CallCourier ka ProcessDescForPortal -> Shopify FulfillmentEventStatus
const STATUS_MAP = {
  'CONSIGNMENT BOOKED': 'CONFIRMED',
  'PICKED FROM SHIPPER': 'CARRIER_PICKED_UP',
  'ARRIVED AT ORIGIN BRANCH': 'IN_TRANSIT', // ye forward leg hai, pickup ke baad
  'MOVED TO DEST. BRANCH': 'IN_TRANSIT',
  'REACHED AT DEST. BRANCH': 'IN_TRANSIT',
  'OUT FOR DELIVERY': 'OUT_FOR_DELIVERY',
  'DELIVERED': 'DELIVERED',
  'UNDELIVERED': 'ATTEMPTED_DELIVERY',
  'CONTACTING CONSIGNEE': 'DELAYED',

  // --- return leg: parcel wapas aa raha hai ---
  // Shopify ke paas "returning to sender" wala status nahi, FAILURE sab se
  // qareeb hai. In ko IN_TRANSIT rakhne se jaane aur wapas aane wale parcel
  // ka farq mit jaata hai, isi liye alag rakha hai.
  'MOVED TO ORIGIN BRANCH': 'FAILURE',
  'REACHED AT ORIGIN BRANCH': 'FAILURE',
  'OUT FOR RETURN SUBMISSION': 'FAILURE',
  'RETURN SUBMITTED': 'FAILURE',
};

// jo naye status aate rahenge, unhe yahan log karke baad mein map mein daal dena
const unmapped = new Set();

function mapStatus(portalDesc) {
  const key = String(portalDesc || '').trim().toUpperCase();
  const hit = STATUS_MAP[key];
  if (!hit) unmapped.add(key);
  return hit || null;
}

/**
 * CallCourier ka TransactionDate timezone ke bagair aata hai lekin hai UTC.
 * (PostEx ke +05:00 wale record se cross-check kiya hua hai.)
 *
 * Milliseconds jaan boojh kar hata rahe hain: Shopify happenedAt ko seconds
 * par kaat kar store karta hai, aur agar hum ms ke saath bhejein to dedupe
 * kabhi match nahi karta aur har run duplicate event bana deta hai.
 */
function toIso(transactionDate) {
  if (!transactionDate) return null;
  const s = String(transactionDate);
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
  return isNaN(d) ? null : d.toISOString().slice(0, 19) + 'Z';
}

// dedupe hamesha seconds par ho — dono taraf ek hi shakl
function key(status, at) {
  return status + '|' + new Date(at).toISOString().slice(0, 19) + 'Z';
}

// ------------------------------------------------------------- shopify

async function gql(query, variables) {
  const res = await fetch(
    `https://${CFG.shop}/admin/api/${CFG.apiVersion}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': CFG.token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (res.status === 429) {
    await sleep(2000);
    return gql(query, variables);
  }

  const body = await res.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    throw new Error(
      `Shopify ne JSON nahi diya (HTTP ${res.status}): ` + body.slice(0, 80)
    );
  }

  if (json.errors) {
    throw new Error('Shopify GraphQL: ' + JSON.stringify(json.errors));
  }
  return json.data;
}

const ORDERS_QUERY = `
query Shipments($cursor: String, $q: String!) {
  orders(first: 50, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      cancelledAt
      fulfillments(first: 5) {
        id
        displayStatus
        trackingInfo { number }
        events(first: 60) {
          nodes { status happenedAt }
        }
      }
    }
  }
}`;

const EVENT_MUTATION = `
mutation AddEvent($e: FulfillmentEventInput!) {
  fulfillmentEventCreate(fulfillmentEvent: $e) {
    fulfillmentEvent { id status happenedAt }
    userErrors { field message }
  }
}`;

async function fetchShipments() {
  const since = new Date(Date.now() - CFG.days * 864e5).toISOString().slice(0, 10);
  const q = `fulfillment_status:shipped AND created_at:>=${since}`;

  const out = [];
  let cursor = null;
  let settled = 0;

  do {
    const data = await gql(ORDERS_QUERY, { cursor, q });
    const page = data.orders;

    for (const order of page.nodes) {
      if (order.cancelledAt) continue; // cancelled orders bilkul skip

      if (CFG.only.length && !CFG.only.includes(order.name.replace(/^#/, ''))) {
        continue;
      }

      for (const f of order.fulfillments) {
        const tracking = (f.trackingInfo[0] || {}).number;
        if (!tracking) continue; // bina tracking ke kuch nahi kar sakte

        if (CFG.skipFinal && FINAL_STATUSES.has(f.displayStatus)) {
          settled++;
          continue;
        }

        out.push({
          order: order.name,
          fulfillmentId: f.id,
          displayStatus: f.displayStatus,
          tracking,
          existing: f.events.nodes.map((e) => ({
            status: e.status,
            at: e.happenedAt,
          })),
        });
      }
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  if (settled) {
    console.log(`${settled} parcel pehle hi deliver ho chuke — skip`);
  }

  return out;
}

// ------------------------------------------------------------- courier

async function fetchCourier(tracking) {
  const res = await fetch(`${CFG.courierApi}?cn=${encodeURIComponent(tracking)}`);
  if (!res.ok) throw new Error(`courier ${res.status}`);

  // courier sust ho to JSON ki jagah "stream timeout" jaisa text aa jata hai —
  // us par poora run nahi marna chahiye
  const body = await res.text();
  let rows;
  try {
    rows = JSON.parse(body);
  } catch (e) {
    throw new Error('courier ne JSON nahi diya: ' + body.slice(0, 60));
  }

  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => ({
      text: r.ProcessDescForPortal,
      reason: r.ReasonDesc || '',
      city: r.ConsigneeCity || '',
      status: mapStatus(r.ProcessDescForPortal),
      at: toIso(r.TransactionDate),
    }))
    .filter((r) => r.status && r.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at)); // purana pehle
}

// ---------------------------------------------------------------- logic

/**
 * Sirf wo events chuno jo Shopify mein pehle se nahi hain.
 * Isi wajah se script baar baar chalne par duplicate nahi banati.
 */
function pickNewEvents(courierRows, existing) {
  const seen = new Set(existing.map((e) => key(e.status, e.at)));

  let candidates = courierRows;

  if (CFG.mode === 'latest') {
    // sirf aakhri status — column isi se set hota hai
    candidates = courierRows.slice(-1);
  } else {
    // sirf wo jo last recorded event ke baad ke hain
    const lastAt = existing.length
      ? Math.max(...existing.map((e) => new Date(e.at).getTime()))
      : 0;
    candidates = courierRows.filter((r) => new Date(r.at).getTime() > lastAt);
  }

  return candidates.filter((r) => !seen.has(key(r.status, r.at)));
}

async function pushEvent(fulfillmentId, row) {
  // "OK" jaisa bemaani reason message mein nahi chahiye
  const reason = /^(ok)?$/i.test(row.reason.trim()) ? '' : row.reason.trim();
  const message = reason ? `${row.text} (${reason})` : row.text;

  const data = await gql(EVENT_MUTATION, {
    e: {
      fulfillmentId,
      status: row.status,
      happenedAt: row.at,
      message, // CallCourier ka asli text — order timeline par yahi dikhega
      city: row.city || undefined,
      country: 'Pakistan',
    },
  });

  const errs = data.fulfillmentEventCreate.userErrors;
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
}

// ----------------------------------------------------------------- run

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mapLimited(items, limit, fn) {
  const results = [];
  let i = 0;

  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx]);
      } catch (err) {
        results[idx] = { error: err.message };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  if (!CFG.token) {
    console.error('SHOPIFY_TOKEN set nahi hai.');
    process.exit(1);
  }

  // token kis app ka hai aur zaroori scope mila ya nahi
  const who = await gql(`{
    currentAppInstallation {
      app { title }
      accessScopes { handle }
    }
  }`);

  const inst = who.currentAppInstallation;
  const scopes = inst.accessScopes.map((s) => s.handle);
  const canWrite = scopes.includes('write_fulfillments');

  console.log(`app: ${inst.app.title}`);
  console.log(`write_fulfillments: ${canWrite ? 'yes' : 'NO — scope missing'}`);
  console.log(
    `mode=${CFG.mode}  days=${CFG.days}  dryRun=${CFG.dryRun ? 'yes' : 'no'}\n`
  );

  if (!canWrite && !CFG.dryRun) {
    console.error('write_fulfillments ke bagair events nahi likh sakte.');
    process.exit(1);
  }

  const shipments = await fetchShipments();
  console.log(`${shipments.length} shipments mile jin par tracking number hai\n`);

  let added = 0;
  let skipped = 0;
  let failed = 0;

  await mapLimited(shipments, CFG.concurrency, async (s) => {
    let rows;
    try {
      rows = await fetchCourier(s.tracking);
    } catch (err) {
      failed++;
      console.log(`${s.order}  courier error: ${err.message}`);
      return;
    }

    if (!rows.length) {
      skipped++;
      return;
    }

    const fresh = pickNewEvents(rows, s.existing);

    if (!fresh.length) {
      skipped++;
      return;
    }

    for (const row of fresh) {
      const line = `${s.order}  ${row.text}  ->  ${row.status}`;

      if (CFG.dryRun) {
        console.log('[dry] ' + line);
        added++;
        continue;
      }

      try {
        await pushEvent(s.fulfillmentId, row);
        console.log('  ok  ' + line);
        added++;
      } catch (err) {
        failed++;
        console.log(' FAIL ' + line + '  — ' + err.message);
      }
    }
  });

  console.log(
    `\nadded=${added}  already-up-to-date=${skipped}  failed=${failed}`
  );

  if (unmapped.size) {
    console.log('\nये status map mein nahi hain (inhe STATUS_MAP mein add karein):');
    for (const u of unmapped) console.log('  - ' + u);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
