-- Only `Default` is seeded now: drop the catalog built-ins nothing is attached to, keep the rest as ordinary scenarios.
DELETE FROM "scenarios" s
WHERE s."builtin" AND s."name" <> 'Default'
  AND NOT EXISTS (SELECT 1 FROM "guards" g WHERE g."scenario_id" = s."id")
  AND NOT EXISTS (SELECT 1 FROM "prompts" p WHERE p."scope" = 'scenario' AND p."scope_ref" = s."id"::text)
  AND NOT EXISTS (SELECT 1 FROM "layers" l WHERE l."scope" = 'scenario' AND l."scope_ref" = s."id"::text)
  AND NOT EXISTS (SELECT 1 FROM "layer_overrides" o WHERE o."scope" = 'scenario' AND o."scope_ref" = s."id"::text);
--> statement-breakpoint
UPDATE "scenarios" SET "builtin" = false WHERE "builtin" AND "name" <> 'Default';
