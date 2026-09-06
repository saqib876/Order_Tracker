-- ============================================================================
-- Q&A v2 — poora sawaal padhne wala system
-- Ise ek dafa Supabase → SQL Editor mein chala dein. Dobara chalane se koi
-- nuqsan nahi (sab kuch "if not exists" hai).
-- ============================================================================

-- ── 1. Shopify confirmation number (jaise N8FNNZAKE) ───────────────────────
-- Customer ko order place karte waqt yehi number milta hai, aur bohat log
-- WhatsApp par yehi bhejte hain (order number nahi).
alter table orders add column if not exists confirmation_number text;

create index if not exists orders_confirmation_number_idx
  on orders (upper(confirmation_number));


-- ── 2. Q&A v2 — keywords ki jagah poore sawaal ─────────────────────────────
-- 'questions' column mein har line par ek poora sawaal likhein, jaise:
--     mera order kab tak milega
--     order kitne din mein aata hai
--     delivery kab hogi
-- Purani 'qna' table bhi chalti rahegi — matcher dono ko parhta hai.
create table if not exists qna_topics (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null,
  questions   text not null,
  answer      text not null,
  priority    int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists qna_topics_active_idx on qna_topics (is_active);


-- ── 3. unmatched_messages — Excel export track karne ke liye ───────────────
-- exported_at null = ye sawaal abhi tak Excel mein nahi gaya.
alter table unmatched_messages add column if not exists exported_at timestamptz;

create index if not exists unmatched_messages_exported_idx
  on unmatched_messages (exported_at);


-- ── 4. Manual review queue ─────────────────────────────────────────────────
-- Order cancel / address change / design change / phone number change —
-- ye messages yahan aate hain taake aap khud dekh sakein.
create table if not exists manual_review_queue (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null,
  message_text  text not null,
  reason        text not null,          -- order_cancel | address_change | design_change | phone_change
  order_number  text,
  status        text not null default 'pending',   -- pending | done
  created_at    timestamptz not null default now(),
  handled_at    timestamptz
);

create index if not exists manual_review_status_idx
  on manual_review_queue (status, created_at desc);

create index if not exists manual_review_phone_idx
  on manual_review_queue (phone);


-- ── 5. Greeting kis ko bhej chuke hain ─────────────────────────────────────
-- Naya customer (ya 24 ghante baad wapas aane wala) — usse pehle greeting
-- jati hai, phir uske sawaal ka jawab. Yeh table sirf itna yaad rakhta hai
-- ke kis number ko aakhri baar kab greeting bheji thi.
create table if not exists wa_greeted (
  phone       text primary key,
  greeted_at  timestamptz not null default now()
);
