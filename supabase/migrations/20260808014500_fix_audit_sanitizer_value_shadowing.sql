create or replace function public.sanitize_audit_metadata(input_value jsonb)
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
  if input_value is null then
    return '{}'::jsonb;
  end if;

  if pg_column_size(input_value) > 32768 then
    return '{"truncated":true}'::jsonb;
  end if;

  if jsonb_typeof(input_value) = 'object' then
    for entry in
      select object_entry.key, object_entry.value as nested_value
      from jsonb_each(input_value) as object_entry(key, value)
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

  if jsonb_typeof(input_value) = 'array' then
    for array_item in select jsonb_array_elements(input_value)
    loop
      sanitized_array := sanitized_array || jsonb_build_array(public.sanitize_audit_metadata(array_item));
    end loop;
    return sanitized_array;
  end if;

  return input_value;
exception
  when others then
    return '{"sanitization_error":true}'::jsonb;
end;
$$;

revoke all on function public.sanitize_audit_metadata(jsonb) from public;
grant execute on function public.sanitize_audit_metadata(jsonb) to service_role;
