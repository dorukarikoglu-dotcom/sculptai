-- SculptAI Veritabanı Kurulumu
-- Bu kodu Supabase > SQL Editor'a yapıştırıp "Run" tıkla

-- 1. Doktorlar tablosu
create table doctors (
  id text primary key,           -- örn: "dr-ahmet"
  auth_id uuid,                  -- Supabase Auth kullanıcı id'si (RLS eşleşmesi)
  name text not null,            -- örn: "Dr. Ahmet Yılmaz"
  username text unique not null, -- giriş kullanıcı adı
  password_hash text not null,   -- legacy alan; Auth'a geçen hesaplarda "managed_by_auth"
  created_at timestamptz default now()
);

-- 2. Hasta kayıtları tablosu
create table patients (
  id text primary key,
  doctor_id text references doctors(id),
  date text not null,
  risk_score integer,
  segment text,
  segment_en text,
  color text,
  icon text,
  badge text,
  action text,
  mot_risk integer,
  exp_risk integer,
  comp_score integer,
  ai_text text default '',
  ai_loading boolean default true,
  answers jsonb,
  created_at timestamptz default now()
);

-- 3. Güvenlik: RLS — hasta formu (anon) yalnız INSERT; okuma/yazma sahibi
--    doktora ve admin'e açık. Detay ve mevcut kuruluma migrasyon:
--    supabase-rls-fix.sql
alter table doctors enable row level security;
alter table patients enable row level security;

create policy "doctors_select_own" on doctors for select to authenticated
  using (auth_id = auth.uid() or (auth.jwt()->>'email') = 'admin@sculptai.health');
create policy "doctors_update_own" on doctors for update to authenticated
  using      (auth_id = auth.uid() or (auth.jwt()->>'email') = 'admin@sculptai.health')
  with check (auth_id = auth.uid() or (auth.jwt()->>'email') = 'admin@sculptai.health');
create policy "doctors_insert_self" on doctors for insert to authenticated
  with check (auth_id = auth.uid() or (auth.jwt()->>'email') = 'admin@sculptai.health');
create policy "doctors_delete_admin" on doctors for delete to authenticated
  using ((auth.jwt()->>'email') = 'admin@sculptai.health');

create policy "patients_insert_public" on patients for insert to anon, authenticated
  with check (doctor_id is not null);
create policy "patients_select_own" on patients for select to authenticated
  using (doctor_id in (select id from doctors where auth_id = auth.uid())
         or (auth.jwt()->>'email') = 'admin@sculptai.health');
create policy "patients_update_own" on patients for update to authenticated
  using      (doctor_id in (select id from doctors where auth_id = auth.uid())
              or (auth.jwt()->>'email') = 'admin@sculptai.health')
  with check (doctor_id in (select id from doctors where auth_id = auth.uid())
              or (auth.jwt()->>'email') = 'admin@sculptai.health');
create policy "patients_delete_own" on patients for delete to authenticated
  using (doctor_id in (select id from doctors where auth_id = auth.uid())
         or (auth.jwt()->>'email') = 'admin@sculptai.health');

-- 4. Örnek doktorlar (sonra değiştirebilirsin)
insert into doctors (id, name, username, password_hash) values
  ('dr-ahmet', 'Dr. Ahmet Yılmaz', 'ahmet', 'sculpt2024'),
  ('dr-ayse',  'Dr. Ayşe Kaya',    'ayse',  'sculpt2024'),
  ('dr-mehmet','Dr. Mehmet Demir', 'mehmet','sculpt2024');

-- Tamamdır! Çalıştırdıktan sonra Claude'a "hazır" de.
