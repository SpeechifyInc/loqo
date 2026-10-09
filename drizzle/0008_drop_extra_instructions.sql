ALTER TABLE "projects" DROP COLUMN "extra_instructions";
--> statement-breakpoint
-- Its variable is gone: the built-in fragment would render empty forever.
DELETE FROM "prompts" WHERE "builtin" AND "name" = 'translate/extra-instructions' AND "scope" = 'default';
