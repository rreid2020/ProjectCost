CREATE TABLE "guide_mark" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"step_key" text NOT NULL,
	"period" text NOT NULL,
	"status" text NOT NULL,
	"user_id" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guide_mark" ADD CONSTRAINT "guide_mark_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guide_mark_company_step_period" ON "guide_mark" USING btree ("company_id","step_key","period");