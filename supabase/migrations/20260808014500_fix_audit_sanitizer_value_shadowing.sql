create or replace function public.sanitize_audit_metadata(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  result jsonb := '{}'::jsonb;
  entry record;
  sanitized_array jsonb := '[]'::jsonb;
  array_item jsonb;
begin
  if $1 is null then
    return '{}'::jsonb;
  end if;

  if pg_column_size($1) > 32768 then
    return '{"truncated":true}'::jsonb;
  end if;

  if jsonb_typeof($1) = 'object' then
    for entry in
      select object_entry.object_key as key, object_entry.object_value as nested_value
      from jsonb_each($1) as object_entry(object_key, object_value)
    loop
      if entry.key ~* '(password|secret|client[_-]?secret|site[_-]?secret|token|access[_-]?token|refresh[_-]?token|authorization|cookie|set[_-]?cookie|signature|x[_-]?veridia[_-]?signature|supabase[_-]?service[_-]?role[_-]?key|ciphertext|(^|[_-])iv($|[_-])|auth(entication)?[_-]?tag|(^|[_-])tag($|[_-])|message|session|jwt|api[_-]?key|email|phone|address|ip)' then
        result := result || jsonb_build_object(entry.key, '[REDACTED]');
      else
        result := result || jsonb_build_object(
          entry.key,
          public.sanitize_audit_metadata(entry.nested_value)
        );
      end if;
    end loop;
    return result;
  end if;

  if jsonb_typeof($1) = 'array' then
    for array_item in select jsonb_array_elements($1)
    loop
      sanitized_array := sanitized_array || jsonb_build_array(public.sanitize_audit_metadata(array_item));
    end loop;
    return sanitized_array;
  end if;

  return $1;
exception
  when others then
    return '{"sanitization_error":true}'::jsonb;
end;
$$;

revoke all on function public.sanitize_audit_metadata(jsonb) from public;
grant execute on function public.sanitize_audit_metadata(jsonb) to service_role;
