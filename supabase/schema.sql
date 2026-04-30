-- ============================================================
-- Shopify Order Tracker - Supabase Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_order_id    TEXT NOT NULL UNIQUE,
  order_number        TEXT NOT NULL,
  customer_email      TEXT,
  customer_phone      TEXT,
  customer_name       TEXT,
  status              TEXT NOT NULL DEFAULT 'in_process',
  tracking_id         TEXT,                          -- PostEx tracking ID (set when shipped)
  line_items          JSONB DEFAULT '[]',            -- product names/qtys snapshot
  shopify_created_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Status history table (audit log of every status change)
CREATE TABLE IF NOT EXISTS order_status_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id    UUID REFERENCES orders(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  note        TEXT,
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_order_number   ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_history_order_id      ON order_status_history(order_id);

-- ── Auto-update updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Auto-delete orders older than 30 days ───────────────────
-- This function is called by the cron job in Next.js
-- But you can also run it directly or schedule via pg_cron
CREATE OR REPLACE FUNCTION delete_old_orders()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM orders
  WHERE created_at < NOW() - INTERVAL '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ── Row Level Security ───────────────────────────────────────
-- Enable RLS so the anon key can only READ orders, not write
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;

-- Anon users (customer tracking page) can read orders
-- but ONLY their own (matched by email or phone — enforced in app logic)
CREATE POLICY "anon_read_orders" ON orders
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_history" ON order_status_history
  FOR SELECT TO anon USING (true);

-- Only service_role (your backend) can insert/update/delete
CREATE POLICY "service_write_orders" ON orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_write_history" ON order_status_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Valid status values (for reference) ──────────────────────
-- in_process      → order received, being worked on
-- printing_done   → print/production completed
-- packed          → packed and ready
-- ready_to_ship   → ready for courier pickup
-- shipped         → handed to PostEx, tracking_id is set
-- delivered       → PostEx confirms delivery
