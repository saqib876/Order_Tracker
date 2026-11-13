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
  reason        text not null,
  -- tabdeeli: order_cancel | address_change | model_change | design_change | phone_change
  -- shikayat: wrong_model_received | wrong_design_received | missing_items | quality_issue
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


-- ── 6. Ek customer ki ek hi review row ─────────────────────────────────────
-- Pehle har cancel message par nayi row banti thi, is liye ek hi customer ke
-- 3-4 card list mein aa jate the. Ab isi number ki isi wajah ki pending row
-- mein naya message jur jata hai — ye do khane us ke liye hain.
alter table manual_review_queue add column if not exists message_count int not null default 1;
alter table manual_review_queue add column if not exists last_message_at timestamptz;

update manual_review_queue set last_message_at = created_at where last_message_at is null;

-- ── Ek hi tracking dobara na jaye ────────────────────────────────────────
-- Customer ek hi order number do-teen dafa bhej deta hai; har dafa wahi
-- lamba tracking message jata tha. Ab bot yaad rakhta hai ke kis number ko
-- kaun sa order kab bheja — 24 ghante (TRACKING_REPEAT_HOURS) ke andar
-- wahi order dobara aaye to chup rehta hai. Doosra order number ho to jawab.
--
-- Table na ho to bot tootta nahi — bas purane tareeqe se har dafa bhejta hai.
create table if not exists wa_tracking_sent (
  phone        text        not null,
  order_number text        not null,
  sent_at      timestamptz not null default now(),
  primary key (phone, order_number)
);

-- Sirf service role (bot) parhta/likhta hai — anon key ke liye band
alter table wa_tracking_sent enable row level security;

-- ── Ek hi jawab dobara na jaye ───────────────────────────────────────────
-- Customer aksar ek hi baat do message mein likhta hai, ya ek hi order ki do
-- tasveerein bhejta hai. Pehle har message ka alag jawab jata tha (do dafa
-- paisa). Ab bilkul wohi matan isi number ko 15 minute tak dobara nahi jata.
create table if not exists wa_recent_reply (
  phone      text        not null,
  reply_hash text        not null,
  sent_at    timestamptz not null default now(),
  primary key (phone, reply_hash)
);
alter table wa_recent_reply enable row level security;
create index if not exists wa_recent_reply_sent_at_idx on wa_recent_reply (sent_at);

-- ── Jab aap khud customer se baat kar rahe hon ───────────────────────────
-- Bot jo message bhejta hai us ka id yahan mehfooz hota hai. Webhook mein
-- kisi aise message ki khabar aaye jo is list mein nahi, matlab wo aap ne
-- (ya team ne) apne haath se bheja — phir bot us customer se kuch ghante
-- bilkul khamosh ho jata hai.
create table if not exists wa_bot_message (
  message_id text primary key,
  phone      text not null,
  sent_at    timestamptz not null default now()
);
create index if not exists wa_bot_message_phone_idx on wa_bot_message (phone, sent_at desc);
alter table wa_bot_message enable row level security;

create table if not exists wa_human_pause (
  phone      text primary key,
  until      timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table wa_human_pause enable row level security;

-- ══ AI: message ko samajhna (keyword ke bajaye matlab) ══════════════════════
--
-- Do tables, dono sirf PAISA aur QUOTA bachane ke liye hain. AI ka jawab
-- (sirf topic ka naam) yahan mehfooz hota hai, taake bilkul wohi jumla
-- dobara aaye to AI se puchna hi na pade.

-- Ek jumle ka faisla. message_hash mein topics ki list ka version bhi shamil
-- hai — Excel mein naya topic add karein to purane faisle khud hi bekaar ho
-- jate hain aur AI dobara, nayi list dekh kar faisla karta hai.
create table if not exists ai_topic_cache (
  message_hash text primary key,
  topic        text,
  insaan       boolean     not null default false,
  sample       text,
  created_at   timestamptz not null default now()
);
alter table ai_topic_cache enable row level security;
create index if not exists ai_topic_cache_created_idx on ai_topic_cache (created_at desc);

-- Har AI call ka hisaab. Isi se roz ki hadd (AI_MAX_PER_DAY) ginti jati hai,
-- aur aap dekh sakte hain ke AI ne kis topic ka faisla kitni dafa kiya.
create table if not exists ai_call_log (
  id         bigserial   primary key,
  provider   text        not null,
  model      text,
  topic      text,
  insaan     boolean     not null default false,
  ms         integer,
  created_at timestamptz not null default now()
);
alter table ai_call_log enable row level security;
create index if not exists ai_call_log_created_idx on ai_call_log (created_at desc);

-- Purana cache aur log khud saaf karne ke liye (kabhi kabhi chala dein):
--   delete from ai_topic_cache where created_at < now() - interval '90 days';
--   delete from ai_call_log   where created_at < now() - interval '60 days';

-- ══ AI khud Q&A bank behtar banata hai ═════════════════════════════════════
--
-- Hafte mein ek dafa AI un messages ko parhta hai jin ka bot jawab nahi de
-- saka, aur TAJWEEZ deta hai: ye sawaal is topic mein daal dein, ya ye naya
-- topic bana lein. Kuch bhi apne aap live NAHI hota — sab "pending" rehta
-- hai jab tak aap /admin/qna par approve na karein.
create table if not exists qna_suggestions (
  id          uuid primary key default gen_random_uuid(),
  -- naya_topic = poora naya topic bane | naya_sawaal = maujooda topic mein sawaal jurein
  kind        text        not null,
  topic       text        not null,
  questions   text[]      not null default '{}',
  samples     text[]      not null default '{}',
  -- customers ne ye baat kitni dafa ki
  ask_count   integer     not null default 0,
  -- naye topic ka jawab aap khud likhte hain (approve karte waqt)
  answer      text,
  -- pending | approved | rejected
  status      text        not null default 'pending',
  batch_id    text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
alter table qna_suggestions enable row level security;
create index if not exists qna_suggestions_status_idx on qna_suggestions (status, created_at desc);

-- Apne maujooda order ki khabar wale sawaal ("mera order kab aayega") Excel
-- ki list mein nahi jate — un ka apna rasta hai (tracking). Phir bhi record
-- rehta hai, taake dekha ja sake ke log kya poochh rahe hain.
create table if not exists order_sawaal_log (
  id           bigserial   primary key,
  phone        text        not null,
  message_text text        not null,
  created_at   timestamptz not null default now()
);
alter table order_sawaal_log enable row level security;
create index if not exists order_sawaal_log_created_idx on order_sawaal_log (created_at desc);

-- ══ Topic band kyun hai ════════════════════════════════════════════════════
-- Band topic ke saamne wajah likhi ja sakti hai — sirf aap ki yaad-dasht ke
-- liye, bot is se koi faisla nahi karta.
alter table qna_topics add column if not exists off_reason text;

-- "Model / Design Availability" jaan boojh kar band hai — us ki wajah likh
-- dete hain, taake baad mein ye sawaal na uthe ke ise kyun band kiya tha.
update qna_topics
   set off_reason = 'Jaan boojh kar band — model/availability wale sawaal ab "Yes Available" wale raste se jate hain (modelQuery.ts), is topic se nahi.'
 where is_active = false
   and off_reason is null
   and topic ilike 'Model / Design Availability%';

-- ══ Aap ke apne (bot ke nahi) bheje hue message ════════════════════════════
--
-- Meta hamein sirf itna batata hai ke "ek message bahar gaya" — MATAN nahi.
-- Is liye bot apni aankh se aap ka QUICK REPLY (jo har customer ko jata hai)
-- aur aap ki apni likhai mein farq nahi kar sakta.
--
-- Chunanche ginti se faisla hota hai: quick reply ek hi message hota hai,
-- jabke waqai baat karne par aap ek se zyada message likhte hain. Ye table
-- wohi ginti rakhti hai.
--
-- message_id primary key hai, is liye ek hi message ki "sent / delivered /
-- read" teen khabrein aayen to bhi wo EK hi gina jata hai.
create table if not exists wa_human_message (
  message_id text        primary key,
  phone      text        not null,
  sent_at    timestamptz not null default now()
);
alter table wa_human_message enable row level security;
create index if not exists wa_human_message_phone_idx on wa_human_message (phone, sent_at desc);

-- smb_message_echoes chalu hone ke baad Meta aap ke bheje hue message ka
-- MATAN bhi deta hai. Us se pakki pehchan mumkin hui: quick reply wo matan
-- hai jo KAI ALAG customers ko jata hai, jabke aap ki apni likhai sirf ek
-- customer ke liye hoti hai.
alter table wa_human_message add column if not exists text_hash text;
alter table wa_human_message add column if not exists sample text;
create index if not exists wa_human_message_hash_idx on wa_human_message (text_hash);

-- ───────────────────────────────────────────────────────────────────────────
-- 13. wa_manual_jawab — cancel / return / address ka jawab EK HI DAFA
--
-- Customer ek hi baat kai dafa likhta hai ("cancel kar dein", phir "cancel?",
-- phir "please cancel"). Jawab pehli dafa chala jata hai; us ke baad us ki
-- request aap ke manual check mein darj hoti rehti hai lekin message dobara
-- nahi jata.
--
-- Chaabi (phone + reason) hi pehredar hai: doosri dafa likhne ki koshish
-- nakaam ho jati hai.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists wa_manual_jawab (
  phone    text not null,
  reason   text not null,
  sent_at  timestamptz not null default now(),
  primary key (phone, reason)
);

alter table wa_manual_jawab enable row level security;
