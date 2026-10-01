CREATE TABLE "guards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"code" text NOT NULL,
	"repair" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "guard_rules" CASCADE;--> statement-breakpoint
ALTER TABLE "guards" ADD CONSTRAINT "guards_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guards_scenario_name" ON "guards" USING btree ("scenario_id","name");