CREATE TABLE "overhead_account" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"qbo_account_id" text NOT NULL,
	"name" text NOT NULL,
	"section" text NOT NULL,
	"included" boolean
);
--> statement-breakpoint
CREATE TABLE "overhead_month" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"qbo_account_id" text NOT NULL,
	"month" text NOT NULL,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "overhead_basis" text DEFAULT 'labour_cost' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "overhead_rate_mode" text DEFAULT 'calculated' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "overhead_manual_rate" integer;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD COLUMN "qbo_account_id" text;--> statement-breakpoint
ALTER TABLE "overhead_account" ADD CONSTRAINT "overhead_account_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_month" ADD CONSTRAINT "overhead_month_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "overhead_account_company_qbo" ON "overhead_account" USING btree ("company_id","qbo_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "overhead_month_company_account_month" ON "overhead_month" USING btree ("company_id","qbo_account_id","month");