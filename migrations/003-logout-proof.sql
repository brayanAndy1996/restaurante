GRANT CREATE ON SCHEMA restaurant TO restaurante_auth_lookup;
CREATE FUNCTION restaurant.logout_proof(token text,csrf text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,restaurant AS $logout$ SELECT EXISTS(SELECT 1 FROM restaurant.sessions s WHERE s.token_hash=token AND s.csrf_token=csrf) $logout$;
ALTER FUNCTION restaurant.logout_proof(text,text) OWNER TO restaurante_auth_lookup;
REVOKE ALL ON FUNCTION restaurant.logout_proof(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restaurant.logout_proof(text,text) TO restaurante_runtime;
REVOKE CREATE ON SCHEMA restaurant FROM restaurante_auth_lookup;
INSERT INTO restaurant.metadata(key,value) VALUES('patch003','logout-idempotent');
