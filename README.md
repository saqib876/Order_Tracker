# Shopify Order Tracker

A full-stack order tracking system for your Shopify store. Customers enter their order number + email/phone to see real-time status updates. After shipping, it connects to PostEx for live courier tracking.

---

## Architecture

```
Shopify (order created/updated)
    │
    │  Webhook (HMAC-verified)
    ▼
Next.js API (/api/webhook)  ──────► Supabase (orders table)
    │                                   │
    │  Vercel Cron (daily 2am)          │  Auto-delete orders > 30 days
    ▼                                   │
/api/orders/cleanup ◄──────────────────┘

Customer → Shopify "Track Order" page (iframe)
    │
    │  POST /api/track (order number + email/phone)
    ▼
Next.js API → Supabase lookup → [if shipped] PostEx API
    │
    ▼
Status stepper (in-house) OR live PostEx tracking
```

---

## Setup Guide (Step by Step)

### Step 1 — Supabase

1. Go to [supabase.com](https://supabase.com) → Create a free project
2. Go to **SQL Editor** and run the entire contents of `supabase/schema.sql`
3. Note your project URL and keys from **Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**keep this secret!**)

### Step 2 — Deploy to Vercel

1. Push this project to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → Import your repo
3. Add all environment variables from `.env.example` (fill in your real values)
4. Deploy — Vercel will give you a URL like `https://your-app.vercel.app`

The `vercel.json` file already sets up the daily cron job at 2am to delete old orders.

### Step 3 — Set up Shopify Webhooks

1. In Shopify Admin → **Settings → Notifications → Webhooks**
2. Add two webhooks pointing to `https://your-app.vercel.app/api/webhook`:
   - **Order creation** (`orders/create`)
   - **Order update** (`orders/updated`)
3. Copy the **webhook signing secret** → paste as `SHOPIFY_WEBHOOK_SECRET` in Vercel env vars

### Step 4 — Embed in Shopify

1. In Shopify Admin → **Online Store → Themes → Edit code**
2. Under "Templates" → Add new template → Page → Liquid → name it `track-order`
3. Paste contents of `shopify/page.track-order.liquid`
4. Replace `YOUR-VERCEL-APP.vercel.app` with your actual Vercel domain
5. In Shopify Admin → **Pages** → Add page:
   - Title: "Track Your Order"
   - Template: `page.track-order`
6. Add a link to this page in your store navigation

### Step 5 — Order Status Labels

The webhook reads Shopify order **tags** to determine status. Add these tags to orders in Shopify Admin to update customer-visible status:

| Shopify Tag       | Customer Sees         |
|-------------------|-----------------------|
| `in process`      | In Process            |
| `printing done`   | Printing Done         |
| `packed`          | Packed                |
| `ready to ship`   | Ready to Ship         |
| `shipped`         | Shipped (PostEx live) |
| `delivered`       | Delivered             |

You can add/change tags via: Shopify Admin → Orders → click order → Tags field (top right).

### Step 6 — PostEx Tracking ID

When you ship an order:
1. Add the PostEx tracking number as the **fulfillment tracking number** in Shopify, OR
2. Add an order note attribute with name `tracking_id` and the PostEx number as the value

The webhook will automatically pick it up and switch the customer view to live PostEx tracking.

---

## Project Structure

```
shopify-order-tracker/
├── supabase/
│   └── schema.sql              ← Run this in Supabase SQL Editor
├── shopify/
│   └── page.track-order.liquid ← Paste into Shopify theme editor
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── webhook/route.ts     ← Shopify webhook receiver
│   │   │   ├── track/route.ts       ← Customer order lookup API
│   │   │   └── orders/cleanup/route.ts ← Daily cron cleanup
│   │   ├── track/page.tsx           ← Customer tracking UI
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── supabase.ts         ← DB clients
│   │   ├── postex.ts           ← PostEx API helper
│   │   └── shopify.ts          ← Webhook verification
│   └── types/index.ts          ← All TypeScript types + status config
├── vercel.json                 ← Cron job config (daily 2am)
├── .env.example                ← Copy to .env.local
└── package.json
```

---

## Customisation

**Change status labels** — edit `STATUS_CONFIG` in `src/types/index.ts`

**Change Shopify tag names** — edit `SHOPIFY_TAG_TO_STATUS` in `src/types/index.ts`

**Change cron schedule** — edit `schedule` in `vercel.json` (cron syntax)

**Change retention period** — change `30` in `src/app/api/orders/cleanup/route.ts`

---

## Local Development

```bash
cp .env.example .env.local
# Fill in your env vars

npm install
npm run dev
# App runs at http://localhost:3000/track
```

To test webhooks locally, use [ngrok](https://ngrok.com):
```bash
ngrok http 3000
# Use the https URL as your Shopify webhook endpoint
```
