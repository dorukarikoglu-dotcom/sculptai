-- SculptAI RLS Sıkılaştırma (Güvenlik 5)
-- Supabase > SQL Editor'a yapıştırıp "Run" tıkla.
--
-- Öncesi: tüm politikalar using(true) idi — anon anahtarla herkes tüm hasta
-- kayıtlarını okuyabilir/değiştirebilir/silebilirdi.
-- Sonrası: hasta formu (anon) yalnız INSERT edebilir; okuma/güncelleme/silme
-- yalnız kaydın sahibi doktora (auth.uid eşleşmesi) ve admin'e açıktır.
--
-- NOT: Bu betik çalıştıktan sonra panele girişli doktorların oturumu Supabase
-- Auth session'ı gerektirir — aktif kullanıcıların bir kez çıkıp yeniden
-- giriş yapması gerekir (login zaten setSession kuruyor).

-- 1. Eski gevşek politikaları kaldır
drop policy if exists "doctors_public"  on doctors;
drop policy if exists "patients_insert" on patients;
drop policy if exists "patients_select" on patients;
drop policy if exists "patients_delete" on patients;
drop policy if exists "patients_update" on patients;
-- Canlıda başka adla politika kaldıysa görmek için:
--   select tablename, policyname from pg_policies
--   where tablename in ('doctors','patients','clinic_models');

alter table doctors  enable row level security;
alter table patients enable row level security;

-- 2. DOCTORS — kendi satırı veya admin
create policy "doctors_select_own" on doctors for select to authenticated
  using (auth_id = auth.uid() or (auth.jwt()->>'email') = 'admin@sculptai.health');

create policy "doctors_update_own" on doctors for update to authenticated
  using      (auth_id = auth.uid() or (auth.jwt()->>'email') = 'admin@sculptai.health')
  with check (auth_id = auth.uid() or (auth.jwt()->>'email') = 'admin@sculptai.health');

-- Kayıt akışı: client signUp sonrası kendi satırını ekler (auth_id = auth.uid())
create policy "doctors_insert_self" on doctors for insert to authenticated
  with check (auth_id = auth.uid() or (auth.jwt()->>'email') = 'admin@sculptai.health');

create policy "doctors_delete_admin" on doctors for delete to authenticated
  using ((auth.jwt()->>'email') = 'admin@sculptai.health');

-- 3. PATIENTS — form herkese açık INSERT; gerisi sahibi doktor veya admin
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

-- 4. CLINIC_MODELS — client'tan yalnız admin okur/siler; skorlama service_role
--    ile çalıştığı için RLS'ten etkilenmez
alter table if exists clinic_models enable row level security;
drop policy if exists "clinic_models_admin_select" on clinic_models;
drop policy if exists "clinic_models_admin_delete" on clinic_models;
create policy "clinic_models_admin_select" on clinic_models for select to authenticated
  using ((auth.jwt()->>'email') = 'admin@sculptai.health');
create policy "clinic_models_admin_delete" on clinic_models for delete to authenticated
  using ((auth.jwt()->>'email') = 'admin@sculptai.health');
