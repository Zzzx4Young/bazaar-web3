-- Scope configuration is owner-controlled. Even direct owner INSERT/UPDATE/DELETE
-- leaves an append-only audit; runtime has SELECT only on ReviewAuthorization.
CREATE FUNCTION audit_review_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path FROM CURRENT AS $$
DECLARE row_data record;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  INSERT INTO "FileAccessAudit" ("id", "orderId", "actorId", "action", "details")
  VALUES (gen_random_uuid(), row_data."orderId", row_data."accountId",
    'review_scope_' || lower(TG_OP),
    jsonb_build_object('authorizationId', row_data."id", 'databaseActor', current_user,
      'previous', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      'current', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END));
  RETURN NULL;
END;
$$;
CREATE TRIGGER "ReviewAuthorization_audit" AFTER INSERT OR UPDATE OR DELETE
ON "ReviewAuthorization" FOR EACH ROW EXECUTE FUNCTION audit_review_scope();
