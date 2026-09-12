begin;

create table if not exists public.historical_machine_observation (
  id bigint generated always as identity primary key,
  machine_fingerprint text not null unique,
  make text,
  model text,
  model_family text,
  manufacture_year smallint,
  serial_number text,
  stock_number text,
  category text,
  configuration text,
  spindle_configuration text,
  axes smallint,
  location text,
  country_code text,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  asking_price numeric(18, 2),
  asking_currency text,
  sold_price numeric(18, 2),
  hammer_price numeric(18, 2),
  sale_currency text,
  sold_at date,
  sale_status text not null default 'unknown',
  evidence_tier text not null default 'D',
  best_source_url text,
  source_count integer not null default 0,
  raw_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint historical_machine_year_check check (manufacture_year is null or manufacture_year between 1900 and 2100),
  constraint historical_machine_axes_check check (axes is null or axes between 1 and 20),
  constraint historical_machine_first_last_check check (last_seen >= first_seen),
  constraint historical_machine_asking_price_check check (asking_price is null or asking_price >= 0),
  constraint historical_machine_sold_price_check check (sold_price is null or sold_price >= 0),
  constraint historical_machine_hammer_price_check check (hammer_price is null or hammer_price >= 0),
  constraint historical_machine_asking_currency_check check (asking_currency is null or asking_currency ~ '^[A-Z]{3}$'),
  constraint historical_machine_sale_currency_check check (sale_currency is null or sale_currency ~ '^[A-Z]{3}$'),
  constraint historical_machine_country_code_check check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint historical_machine_sale_status_check check (sale_status in ('active', 'sold', 'auction_closed', 'withdrawn', 'unknown')),
  constraint historical_machine_evidence_tier_check check (evidence_tier in ('A', 'B', 'C', 'D'))
);

create table if not exists public.machinery_source_lineage (
  id bigint generated always as identity primary key,
  observation_id bigint not null references public.historical_machine_observation(id) on delete cascade,
  source_key text not null unique,
  source_name text,
  source_type text,
  source_url text,
  source_record_id text,
  archived_url text,
  extraction_method text,
  observed_at timestamptz not null,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  evidence_tier text not null default 'D',
  seen_count integer not null default 1,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machinery_source_lineage_first_last_check check (last_seen >= first_seen),
  constraint machinery_source_lineage_evidence_tier_check check (evidence_tier in ('A', 'B', 'C', 'D'))
);

create table if not exists public.machinery_ask_price_history (
  id bigint generated always as identity primary key,
  observation_id bigint not null references public.historical_machine_observation(id) on delete cascade,
  source_key text not null,
  price_kind text not null,
  amount numeric(18, 2) not null,
  currency text not null,
  observed_at timestamptz not null,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  seen_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machinery_ask_price_kind_check check (price_kind in ('ask', 'sold', 'hammer')),
  constraint machinery_ask_price_amount_check check (amount >= 0),
  constraint machinery_ask_price_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint machinery_ask_price_first_last_check check (last_seen >= first_seen),
  constraint machinery_ask_price_history_unique unique (observation_id, source_key, price_kind, amount, currency)
);

create table if not exists public.machinery_live_event (
  id bigint generated always as identity primary key,
  idempotency_key text not null unique,
  event_type text not null,
  event_at timestamptz not null,
  source text not null,
  source_id text,
  machine_fingerprint text,
  category text,
  status text,
  evidence_tier text,
  payload jsonb not null default '{}'::jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  occurrences integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machinery_live_event_type_check check (event_type in ('buyer', 'inventory', 'observation', 'deal', 'email_event', 'live_listing')),
  constraint machinery_live_event_evidence_tier_check check (evidence_tier is null or evidence_tier in ('A', 'B', 'C', 'D'))
);

create table if not exists public.machinery_learning_snapshot (
  id bigint generated always as identity primary key,
  snapshot_key text not null unique,
  generated_at timestamptz not null,
  unique_observation_count bigint not null,
  tier_a_count bigint not null,
  tier_b_count bigint not null,
  tier_c_count bigint not null,
  tier_d_count bigint not null,
  source_lineage_count bigint not null,
  ask_price_point_count bigint not null,
  live_event_count bigint not null,
  model_family_count bigint not null,
  allocation jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.machinery_milestone (
  dimension text not null,
  threshold bigint not null,
  current_value bigint not null default 0,
  reached_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (dimension, threshold),
  constraint machinery_milestone_dimension_check check (dimension in ('unique_observations', 'tier_a')),
  constraint machinery_milestone_threshold_check check (threshold > 0),
  constraint machinery_milestone_current_value_check check (current_value >= 0)
);

create table if not exists public.machinery_ingestion_batch (
  batch_key text primary key,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  completed_at timestamptz,
  attempts integer not null default 1,
  observation_count integer not null default 0,
  event_count integer not null default 0,
  constraint machinery_ingestion_batch_attempts_check check (attempts > 0),
  constraint machinery_ingestion_batch_observation_count_check check (observation_count >= 0),
  constraint machinery_ingestion_batch_event_count_check check (event_count >= 0)
);

create index if not exists historical_machine_model_family_idx
  on public.historical_machine_observation (model_family, last_seen desc);
create index if not exists historical_machine_make_family_year_idx
  on public.historical_machine_observation (make, model_family, manufacture_year, last_seen desc);
create index if not exists historical_machine_tier_last_seen_idx
  on public.historical_machine_observation (evidence_tier, last_seen desc);
create index if not exists historical_machine_sold_idx
  on public.historical_machine_observation (sold_at desc, model_family)
  where sale_status in ('sold', 'auction_closed');
create index if not exists machinery_source_lineage_observation_idx
  on public.machinery_source_lineage (observation_id, observed_at desc);
create index if not exists machinery_ask_price_observation_idx
  on public.machinery_ask_price_history (observation_id, observed_at desc);
create index if not exists machinery_live_event_type_at_idx
  on public.machinery_live_event (event_type, event_at desc);
create index if not exists machinery_live_event_machine_idx
  on public.machinery_live_event (machine_fingerprint, event_at desc)
  where machine_fingerprint is not null;
create index if not exists machinery_learning_snapshot_generated_idx
  on public.machinery_learning_snapshot (generated_at desc);

insert into public.machinery_milestone (dimension, threshold)
values
  ('unique_observations', 100),
  ('unique_observations', 500),
  ('unique_observations', 1000),
  ('tier_a', 25),
  ('tier_a', 50),
  ('tier_a', 100),
  ('tier_a', 250),
  ('tier_a', 500)
on conflict (dimension, threshold) do nothing;

create or replace function public.machinery_evidence_rank(p_tier text)
returns integer
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case p_tier when 'A' then 1 when 'B' then 2 when 'C' then 3 else 4 end;
$$;

create or replace function public.machinery_persisted_state(
  p_event_limit integer default 100,
  p_observation_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with counts as (
    select
      count(*)::bigint as unique_observations,
      count(*) filter (where evidence_tier = 'A')::bigint as tier_a,
      count(*) filter (where evidence_tier = 'B')::bigint as tier_b,
      count(*) filter (where evidence_tier = 'C')::bigint as tier_c,
      count(*) filter (where evidence_tier = 'D')::bigint as tier_d,
      count(distinct nullif(model_family, ''))::bigint as model_families
    from public.historical_machine_observation
  ),
  source_counts as (
    select count(*)::bigint as source_lineage from public.machinery_source_lineage
  ),
  price_counts as (
    select count(*)::bigint as ask_price_points from public.machinery_ask_price_history where price_kind = 'ask'
  ),
  event_counts as (
    select count(*)::bigint as live_events from public.machinery_live_event
  ),
  last_persisted as (
    select max(value) as value
    from (
      select max(updated_at) as value from public.historical_machine_observation
      union all
      select max(updated_at) from public.machinery_live_event
      union all
      select max(updated_at) from public.machinery_learning_snapshot
    ) timestamps
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'uniqueObservations', counts.unique_observations,
      'sourceLineage', source_counts.source_lineage,
      'askPricePoints', price_counts.ask_price_points,
      'liveEvents', event_counts.live_events,
      'modelFamilies', counts.model_families
    ),
    'tierBreakdown', jsonb_build_object(
      'A', counts.tier_a,
      'B', counts.tier_b,
      'C', counts.tier_c,
      'D', counts.tier_d
    ),
    'lastPersistedAt', last_persisted.value,
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dimension', dimension,
        'threshold', threshold,
        'currentValue', current_value,
        'reached', reached_at is not null,
        'reachedAt', reached_at
      ) order by dimension desc, threshold)
      from public.machinery_milestone
    ), '[]'::jsonb),
    'learningSnapshot', (
      select jsonb_build_object(
        'snapshotKey', snapshot_key,
        'generatedAt', generated_at,
        'uniqueObservations', unique_observation_count,
        'tierA', tier_a_count,
        'tierB', tier_b_count,
        'tierC', tier_c_count,
        'tierD', tier_d_count,
        'sourceLineage', source_lineage_count,
        'askPricePoints', ask_price_point_count,
        'liveEvents', live_event_count,
        'modelFamilies', model_family_count,
        'allocation', allocation,
        'metrics', metrics,
        'notes', notes
      )
      from public.machinery_learning_snapshot
      order by generated_at desc
      limit 1
    ),
    'modelFamilies', coalesce((
      select jsonb_agg(family_row order by observationCount desc, modelFamily)
      from (
        select jsonb_build_object(
          'make', make,
          'modelFamily', model_family,
          'observationCount', count(*),
          'tierACount', count(*) filter (where evidence_tier = 'A'),
          'lastSeen', max(last_seen)
        ) as family_row,
        count(*) as observationCount,
        model_family as modelFamily
        from public.historical_machine_observation
        where model_family is not null
        group by make, model_family
        order by count(*) desc, model_family
        limit 30
      ) families
    ), '[]'::jsonb),
    'observations', coalesce((
      select jsonb_agg(row_data order by last_seen desc)
      from (
        select jsonb_build_object(
          'machineFingerprint', machine_fingerprint,
          'make', make,
          'model', model,
          'modelFamily', model_family,
          'manufactureYear', manufacture_year,
          'category', category,
          'configuration', configuration,
          'location', location,
          'firstSeen', first_seen,
          'lastSeen', last_seen,
          'askingPrice', asking_price,
          'askingCurrency', asking_currency,
          'soldPrice', sold_price,
          'hammerPrice', hammer_price,
          'saleCurrency', sale_currency,
          'soldAt', sold_at,
          'saleStatus', sale_status,
          'evidenceTier', evidence_tier,
          'sourceCount', source_count,
          'bestSourceUrl', best_source_url
        ) as row_data,
        last_seen
        from public.historical_machine_observation
        order by last_seen desc
        limit greatest(0, least(coalesce(p_observation_limit, 100), 500))
      ) recent_observations
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(row_data order by event_at desc)
      from (
        select (
          payload || jsonb_build_object(
            'id', id,
            'idempotencyKey', idempotency_key,
            'type', event_type,
            'ts', event_at,
            'source', source,
            'sourceId', source_id,
            'machineFingerprint', machine_fingerprint,
            'category', category,
            'status', status,
            'evidenceTier', evidence_tier,
            'occurrences', occurrences
          )
        ) as row_data,
        event_at
        from public.machinery_live_event
        order by event_at desc
        limit greatest(0, least(coalesce(p_event_limit, 100), 500))
      ) recent_events
    ), '[]'::jsonb)
  )
  from counts, source_counts, price_counts, event_counts, last_persisted;
$$;

create or replace function public.machinery_ingest_batch(
  p_batch_key text,
  p_observations jsonb default '[]'::jsonb,
  p_events jsonb default '[]'::jsonb,
  p_learning_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_source jsonb;
  v_observation_id bigint;
  v_now timestamptz := now();
  v_inserted integer := 0;
  v_unique_count bigint := 0;
  v_tier_a bigint := 0;
  v_tier_b bigint := 0;
  v_tier_c bigint := 0;
  v_tier_d bigint := 0;
  v_source_count bigint := 0;
  v_ask_count bigint := 0;
  v_event_count bigint := 0;
  v_family_count bigint := 0;
  v_snapshot_key text;
  v_generated_at timestamptz;
begin
  if p_batch_key is null or btrim(p_batch_key) = '' then
    raise exception 'batch_key_required';
  end if;
  if jsonb_typeof(coalesce(p_observations, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array' then
    raise exception 'observations_and_events_must_be_arrays';
  end if;
  if jsonb_array_length(coalesce(p_observations, '[]'::jsonb))
    + jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 200 then
    raise exception 'batch_too_large';
  end if;

  insert into public.machinery_ingestion_batch (batch_key)
  values (p_batch_key)
  on conflict (batch_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    update public.machinery_ingestion_batch
    set last_received_at = v_now, attempts = attempts + 1
    where batch_key = p_batch_key;
    return jsonb_build_object('replayed', true, 'state', public.machinery_persisted_state(100, 100));
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_observations, '[]'::jsonb))
  loop
    insert into public.historical_machine_observation (
      machine_fingerprint, make, model, model_family, manufacture_year,
      serial_number, stock_number, category, configuration, spindle_configuration,
      axes, location, country_code, first_seen, last_seen, asking_price,
      asking_currency, sold_price, hammer_price, sale_currency, sold_at,
      sale_status, evidence_tier, best_source_url, raw_summary
    ) values (
      v_item->>'machine_fingerprint', nullif(v_item->>'make', ''), nullif(v_item->>'model', ''),
      nullif(v_item->>'model_family', ''), nullif(v_item->>'manufacture_year', '')::smallint,
      nullif(v_item->>'serial_number', ''), nullif(v_item->>'stock_number', ''),
      nullif(v_item->>'category', ''), nullif(v_item->>'configuration', ''),
      nullif(v_item->>'spindle_configuration', ''), nullif(v_item->>'axes', '')::smallint,
      nullif(v_item->>'location', ''), nullif(v_item->>'country_code', ''),
      coalesce(nullif(v_item->>'first_seen', '')::timestamptz, v_now),
      coalesce(nullif(v_item->>'last_seen', '')::timestamptz, v_now),
      nullif(v_item->>'asking_price', '')::numeric, nullif(v_item->>'asking_currency', ''),
      nullif(v_item->>'sold_price', '')::numeric, nullif(v_item->>'hammer_price', '')::numeric,
      nullif(v_item->>'sale_currency', ''), nullif(v_item->>'sold_at', '')::date,
      coalesce(nullif(v_item->>'sale_status', ''), 'unknown'),
      coalesce(nullif(v_item->>'evidence_tier', ''), 'D'),
      nullif(v_item->>'best_source_url', ''), coalesce(v_item->'raw_summary', '{}'::jsonb)
    )
    on conflict (machine_fingerprint) do update set
      make = coalesce(excluded.make, historical_machine_observation.make),
      model = coalesce(excluded.model, historical_machine_observation.model),
      model_family = coalesce(excluded.model_family, historical_machine_observation.model_family),
      manufacture_year = coalesce(excluded.manufacture_year, historical_machine_observation.manufacture_year),
      serial_number = coalesce(excluded.serial_number, historical_machine_observation.serial_number),
      stock_number = coalesce(excluded.stock_number, historical_machine_observation.stock_number),
      category = coalesce(excluded.category, historical_machine_observation.category),
      configuration = coalesce(excluded.configuration, historical_machine_observation.configuration),
      spindle_configuration = coalesce(excluded.spindle_configuration, historical_machine_observation.spindle_configuration),
      axes = coalesce(excluded.axes, historical_machine_observation.axes),
      location = coalesce(excluded.location, historical_machine_observation.location),
      country_code = coalesce(excluded.country_code, historical_machine_observation.country_code),
      first_seen = least(historical_machine_observation.first_seen, excluded.first_seen),
      last_seen = greatest(historical_machine_observation.last_seen, excluded.last_seen),
      asking_price = coalesce(excluded.asking_price, historical_machine_observation.asking_price),
      asking_currency = coalesce(excluded.asking_currency, historical_machine_observation.asking_currency),
      sold_price = coalesce(excluded.sold_price, historical_machine_observation.sold_price),
      hammer_price = coalesce(excluded.hammer_price, historical_machine_observation.hammer_price),
      sale_currency = coalesce(excluded.sale_currency, historical_machine_observation.sale_currency),
      sold_at = coalesce(excluded.sold_at, historical_machine_observation.sold_at),
      sale_status = case when excluded.sale_status <> 'unknown' then excluded.sale_status else historical_machine_observation.sale_status end,
      evidence_tier = case
        when public.machinery_evidence_rank(excluded.evidence_tier) < public.machinery_evidence_rank(historical_machine_observation.evidence_tier)
          then excluded.evidence_tier
        else historical_machine_observation.evidence_tier
      end,
      best_source_url = coalesce(excluded.best_source_url, historical_machine_observation.best_source_url),
      raw_summary = historical_machine_observation.raw_summary || excluded.raw_summary,
      updated_at = v_now
    returning id into v_observation_id;

    v_source := coalesce(v_item->'source', '{}'::jsonb);
    insert into public.machinery_source_lineage (
      observation_id, source_key, source_name, source_type, source_url,
      source_record_id, archived_url, extraction_method, observed_at,
      first_seen, last_seen, evidence_tier, raw_payload
    ) values (
      v_observation_id, v_source->>'source_key', nullif(v_source->>'source_name', ''),
      nullif(v_source->>'source_type', ''), nullif(v_source->>'source_url', ''),
      nullif(v_source->>'source_record_id', ''), nullif(v_source->>'archived_url', ''),
      nullif(v_source->>'extraction_method', ''),
      coalesce(nullif(v_source->>'observed_at', '')::timestamptz, v_now),
      coalesce(nullif(v_item->>'first_seen', '')::timestamptz, v_now),
      coalesce(nullif(v_item->>'last_seen', '')::timestamptz, v_now),
      coalesce(nullif(v_source->>'evidence_tier', ''), nullif(v_item->>'evidence_tier', ''), 'D'),
      coalesce(v_source->'raw_payload', '{}'::jsonb)
    )
    on conflict (source_key) do update set
      observation_id = excluded.observation_id,
      source_name = coalesce(excluded.source_name, machinery_source_lineage.source_name),
      source_type = coalesce(excluded.source_type, machinery_source_lineage.source_type),
      source_url = coalesce(excluded.source_url, machinery_source_lineage.source_url),
      source_record_id = coalesce(excluded.source_record_id, machinery_source_lineage.source_record_id),
      archived_url = coalesce(excluded.archived_url, machinery_source_lineage.archived_url),
      extraction_method = coalesce(excluded.extraction_method, machinery_source_lineage.extraction_method),
      observed_at = greatest(machinery_source_lineage.observed_at, excluded.observed_at),
      first_seen = least(machinery_source_lineage.first_seen, excluded.first_seen),
      last_seen = greatest(machinery_source_lineage.last_seen, excluded.last_seen),
      evidence_tier = case
        when public.machinery_evidence_rank(excluded.evidence_tier) < public.machinery_evidence_rank(machinery_source_lineage.evidence_tier)
          then excluded.evidence_tier
        else machinery_source_lineage.evidence_tier
      end,
      seen_count = machinery_source_lineage.seen_count + 1,
      raw_payload = machinery_source_lineage.raw_payload || excluded.raw_payload,
      updated_at = v_now;

    update public.historical_machine_observation
    set source_count = (
      select count(*) from public.machinery_source_lineage where observation_id = v_observation_id
    ), updated_at = v_now
    where id = v_observation_id;

    if nullif(v_item->>'asking_price', '') is not null then
      insert into public.machinery_ask_price_history (
        observation_id, source_key, price_kind, amount, currency, observed_at, first_seen, last_seen
      ) values (
        v_observation_id, v_source->>'source_key', 'ask', (v_item->>'asking_price')::numeric,
        coalesce(nullif(v_item->>'asking_currency', ''), 'UNK'),
        coalesce(nullif(v_source->>'observed_at', '')::timestamptz, v_now),
        coalesce(nullif(v_item->>'first_seen', '')::timestamptz, v_now),
        coalesce(nullif(v_item->>'last_seen', '')::timestamptz, v_now)
      )
      on conflict (observation_id, source_key, price_kind, amount, currency) do update set
        observed_at = greatest(machinery_ask_price_history.observed_at, excluded.observed_at),
        first_seen = least(machinery_ask_price_history.first_seen, excluded.first_seen),
        last_seen = greatest(machinery_ask_price_history.last_seen, excluded.last_seen),
        seen_count = machinery_ask_price_history.seen_count + 1,
        updated_at = v_now;
    end if;

    if nullif(v_item->>'sold_price', '') is not null then
      insert into public.machinery_ask_price_history (
        observation_id, source_key, price_kind, amount, currency, observed_at, first_seen, last_seen
      ) values (
        v_observation_id, v_source->>'source_key', 'sold', (v_item->>'sold_price')::numeric,
        coalesce(nullif(v_item->>'sale_currency', ''), 'UNK'),
        coalesce(nullif(v_source->>'observed_at', '')::timestamptz, v_now),
        coalesce(nullif(v_item->>'first_seen', '')::timestamptz, v_now),
        coalesce(nullif(v_item->>'last_seen', '')::timestamptz, v_now)
      ) on conflict (observation_id, source_key, price_kind, amount, currency) do update set
        last_seen = greatest(machinery_ask_price_history.last_seen, excluded.last_seen),
        seen_count = machinery_ask_price_history.seen_count + 1,
        updated_at = v_now;
    end if;

    if nullif(v_item->>'hammer_price', '') is not null then
      insert into public.machinery_ask_price_history (
        observation_id, source_key, price_kind, amount, currency, observed_at, first_seen, last_seen
      ) values (
        v_observation_id, v_source->>'source_key', 'hammer', (v_item->>'hammer_price')::numeric,
        coalesce(nullif(v_item->>'sale_currency', ''), 'UNK'),
        coalesce(nullif(v_source->>'observed_at', '')::timestamptz, v_now),
        coalesce(nullif(v_item->>'first_seen', '')::timestamptz, v_now),
        coalesce(nullif(v_item->>'last_seen', '')::timestamptz, v_now)
      ) on conflict (observation_id, source_key, price_kind, amount, currency) do update set
        last_seen = greatest(machinery_ask_price_history.last_seen, excluded.last_seen),
        seen_count = machinery_ask_price_history.seen_count + 1,
        updated_at = v_now;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    insert into public.machinery_live_event (
      idempotency_key, event_type, event_at, source, source_id,
      machine_fingerprint, category, status, evidence_tier, payload
    ) values (
      v_item->>'idempotency_key', v_item->>'event_type',
      coalesce(nullif(v_item->>'event_at', '')::timestamptz, v_now),
      coalesce(nullif(v_item->>'source', ''), 'collector'), nullif(v_item->>'source_id', ''),
      nullif(v_item->>'machine_fingerprint', ''), nullif(v_item->>'category', ''),
      nullif(v_item->>'status', ''), nullif(v_item->>'evidence_tier', ''),
      coalesce(v_item->'payload', '{}'::jsonb)
    )
    on conflict (idempotency_key) do update set
      event_at = greatest(machinery_live_event.event_at, excluded.event_at),
      source = excluded.source,
      source_id = coalesce(excluded.source_id, machinery_live_event.source_id),
      machine_fingerprint = coalesce(excluded.machine_fingerprint, machinery_live_event.machine_fingerprint),
      category = coalesce(excluded.category, machinery_live_event.category),
      status = coalesce(excluded.status, machinery_live_event.status),
      evidence_tier = coalesce(excluded.evidence_tier, machinery_live_event.evidence_tier),
      payload = machinery_live_event.payload || excluded.payload,
      last_seen = v_now,
      occurrences = machinery_live_event.occurrences + 1,
      updated_at = v_now;
  end loop;

  select
    count(*),
    count(*) filter (where evidence_tier = 'A'),
    count(*) filter (where evidence_tier = 'B'),
    count(*) filter (where evidence_tier = 'C'),
    count(*) filter (where evidence_tier = 'D'),
    count(distinct nullif(model_family, ''))
  into v_unique_count, v_tier_a, v_tier_b, v_tier_c, v_tier_d, v_family_count
  from public.historical_machine_observation;
  select count(*) into v_source_count from public.machinery_source_lineage;
  select count(*) into v_ask_count from public.machinery_ask_price_history where price_kind = 'ask';
  select count(*) into v_event_count from public.machinery_live_event;

  update public.machinery_milestone
  set current_value = case when dimension = 'unique_observations' then v_unique_count else v_tier_a end,
      reached_at = case
        when reached_at is null and (case when dimension = 'unique_observations' then v_unique_count else v_tier_a end) >= threshold
          then v_now
        else reached_at
      end,
      updated_at = v_now;

  v_snapshot_key := coalesce(nullif(p_learning_snapshot->>'snapshot_key', ''), p_batch_key);
  v_generated_at := coalesce(nullif(p_learning_snapshot->>'generated_at', '')::timestamptz, v_now);
  insert into public.machinery_learning_snapshot (
    snapshot_key, generated_at, unique_observation_count, tier_a_count, tier_b_count,
    tier_c_count, tier_d_count, source_lineage_count, ask_price_point_count,
    live_event_count, model_family_count, allocation, metrics, notes
  ) values (
    v_snapshot_key, v_generated_at, v_unique_count, v_tier_a, v_tier_b,
    v_tier_c, v_tier_d, v_source_count, v_ask_count, v_event_count,
    v_family_count, coalesce(p_learning_snapshot->'allocation', '{}'::jsonb),
    coalesce(p_learning_snapshot->'metrics', '{}'::jsonb),
    nullif(p_learning_snapshot->>'notes', '')
  )
  on conflict (snapshot_key) do update set
    generated_at = excluded.generated_at,
    unique_observation_count = excluded.unique_observation_count,
    tier_a_count = excluded.tier_a_count,
    tier_b_count = excluded.tier_b_count,
    tier_c_count = excluded.tier_c_count,
    tier_d_count = excluded.tier_d_count,
    source_lineage_count = excluded.source_lineage_count,
    ask_price_point_count = excluded.ask_price_point_count,
    live_event_count = excluded.live_event_count,
    model_family_count = excluded.model_family_count,
    allocation = excluded.allocation,
    metrics = excluded.metrics,
    notes = coalesce(excluded.notes, machinery_learning_snapshot.notes),
    updated_at = v_now;

  update public.machinery_ingestion_batch
  set completed_at = v_now,
      observation_count = jsonb_array_length(coalesce(p_observations, '[]'::jsonb)),
      event_count = jsonb_array_length(coalesce(p_events, '[]'::jsonb)),
      last_received_at = v_now
  where batch_key = p_batch_key;

  return jsonb_build_object('replayed', false, 'state', public.machinery_persisted_state(100, 100));
end;
$$;

alter table public.historical_machine_observation enable row level security;
alter table public.machinery_source_lineage enable row level security;
alter table public.machinery_ask_price_history enable row level security;
alter table public.machinery_live_event enable row level security;
alter table public.machinery_learning_snapshot enable row level security;
alter table public.machinery_milestone enable row level security;
alter table public.machinery_ingestion_batch enable row level security;

revoke all on table public.historical_machine_observation from anon, authenticated;
revoke all on table public.machinery_source_lineage from anon, authenticated;
revoke all on table public.machinery_ask_price_history from anon, authenticated;
revoke all on table public.machinery_live_event from anon, authenticated;
revoke all on table public.machinery_learning_snapshot from anon, authenticated;
revoke all on table public.machinery_milestone from anon, authenticated;
revoke all on table public.machinery_ingestion_batch from anon, authenticated;
revoke all on function public.machinery_evidence_rank(text) from public, anon, authenticated;
revoke all on function public.machinery_persisted_state(integer, integer) from public, anon, authenticated;
revoke all on function public.machinery_ingest_batch(text, jsonb, jsonb, jsonb) from public, anon, authenticated;

grant select, insert, update, delete on table public.historical_machine_observation to service_role;
grant select, insert, update, delete on table public.machinery_source_lineage to service_role;
grant select, insert, update, delete on table public.machinery_ask_price_history to service_role;
grant select, insert, update, delete on table public.machinery_live_event to service_role;
grant select, insert, update, delete on table public.machinery_learning_snapshot to service_role;
grant select, insert, update, delete on table public.machinery_milestone to service_role;
grant select, insert, update, delete on table public.machinery_ingestion_batch to service_role;
grant usage, select on sequence public.historical_machine_observation_id_seq to service_role;
grant usage, select on sequence public.machinery_source_lineage_id_seq to service_role;
grant usage, select on sequence public.machinery_ask_price_history_id_seq to service_role;
grant usage, select on sequence public.machinery_live_event_id_seq to service_role;
grant usage, select on sequence public.machinery_learning_snapshot_id_seq to service_role;
grant execute on function public.machinery_evidence_rank(text) to service_role;
grant execute on function public.machinery_persisted_state(integer, integer) to service_role;
grant execute on function public.machinery_ingest_batch(text, jsonb, jsonb, jsonb) to service_role;

commit;
