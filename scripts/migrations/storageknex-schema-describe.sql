-- One line per schema object of the current schema, sorted; diffable across databases.
with t as (
  select c.oid, c.relname from pg_class c
  where c.relnamespace = current_schema()::regnamespace and c.relkind in ('r','p')
)
select line from (
  select 'table ' || t.relname as line from t
  union all
  select 'column ' || t.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
    || case when a.attnotnull then ' not null' else ' null' end
    || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
    || case a.attidentity when 'a' then ' identity always' when 'd' then ' identity by default' else '' end
    || case when a.attgenerated <> '' then ' generated' else '' end
  from t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = t.oid and d.adnum = a.attnum
  union all
  select 'constraint ' || t.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
  from t join pg_constraint con on con.conrelid = t.oid
  union all
  select 'index ' || t.relname || ' ' || ic.relname || ' ' || pg_get_indexdef(i.indexrelid)
    || case when not i.indisvalid then ' INVALID' else '' end
  from t join pg_index i on i.indrelid = t.oid join pg_class ic on ic.oid = i.indexrelid
  union all
  select 'sequence ' || s.relname || ' ' || format_type(sq.seqtypid, null) || ' inc ' || sq.seqincrement
    || ' min ' || sq.seqmin || ' max ' || sq.seqmax || ' start ' || sq.seqstart || ' cache ' || sq.seqcache
    || case when sq.seqcycle then ' cycle' else '' end
    || coalesce(' owned by ' || (select tc.relname || '.' || ta.attname
         from pg_depend dp join pg_class tc on tc.oid = dp.refobjid
         join pg_attribute ta on ta.attrelid = dp.refobjid and ta.attnum = dp.refobjsubid
         where dp.objid = s.oid and dp.classid = 'pg_class'::regclass and dp.deptype in ('a','i') limit 1), '')
    || (select case dp.deptype when 'i' then ' (identity)' else '' end from pg_depend dp
         where dp.objid = s.oid and dp.classid = 'pg_class'::regclass and dp.deptype in ('a','i') limit 1)
  from pg_class s join pg_sequence sq on sq.seqrelid = s.oid
  where s.relnamespace = current_schema()::regnamespace
  union all
  select 'other ' || c.relkind::text || ' ' || c.relname from pg_class c
  where c.relnamespace = current_schema()::regnamespace and c.relkind not in ('r','p','i','S','t')
  union all
  select 'function ' || p.proname from pg_proc p where p.pronamespace = current_schema()::regnamespace
  union all
  select 'trigger ' || tg.tgname from pg_trigger tg join t on t.oid = tg.tgrelid where not tg.tgisinternal
  union all
  select 'extension ' || extname from pg_extension where extname <> 'plpgsql'
) x order by line;
