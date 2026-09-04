-- Device screener question: add Linux and Other, keeping Other last, and
-- let Linux pass the desktop check. Touches only the device step; safe to
-- run twice. Run the whole file in the SQL Editor.

update public.tests
set config = jsonb_set(config, '{screener}', (
  select jsonb_agg(
           case when step->>'id' = 'device' then
             jsonb_set(
               jsonb_set(step, '{options}',
                 (select coalesce(jsonb_agg(v order by n), '[]'::jsonb)
                    from (select value v, row_number() over () n
                            from jsonb_array_elements_text(step->'options')) s
                   where v not in ('Linux', 'Other'))
                 || '["Linux", "Other"]'::jsonb),
               '{pass_if_any}',
               case when step ? 'pass_if_any' and not step->'pass_if_any' @> '["Linux"]'
                    then (step->'pass_if_any') || '["Linux"]'::jsonb
                    else coalesce(step->'pass_if_any', '[]'::jsonb) end,
               step ? 'pass_if_any')
           else step end
           order by ord)
  from jsonb_array_elements(config->'screener') with ordinality as e(step, ord)))
where id = 'ahs827sd';
