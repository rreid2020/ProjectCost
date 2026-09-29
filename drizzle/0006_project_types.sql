CREATE TABLE "gl_account" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"qbo_id" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"account_type" text NOT NULL,
	"account_sub_type" text,
	"active" boolean DEFAULT true NOT NULL,
	"is_project_cost" boolean
);
--> statement-breakpoint
CREATE TABLE "project_qbo_link" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"qbo_id" text NOT NULL,
	"qbo_name" text
);
--> statement-breakpoint
CREATE TABLE "project_unit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"date" text NOT NULL,
	"units" integer NOT NULL,
	"sale_amount_cents" bigint,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qbo_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"qbo_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "cip_account_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "wip_inventory_account_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "finished_goods_account_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "cogs_account_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "labour_credit_account_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "project_type" text DEFAULT 'CONTRACT' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "units_planned" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "in_service_date" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "asset_account_id" text;--> statement-breakpoint
ALTER TABLE "gl_account" ADD CONSTRAINT "gl_account_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_qbo_link" ADD CONSTRAINT "project_qbo_link_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_qbo_link" ADD CONSTRAINT "project_qbo_link_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_unit_event" ADD CONSTRAINT "project_unit_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_unit_event" ADD CONSTRAINT "project_unit_event_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_tag" ADD CONSTRAINT "qbo_tag_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gl_account_company_qbo" ON "gl_account" USING btree ("company_id","qbo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_qbo_link_company_kind_qbo" ON "project_qbo_link" USING btree ("company_id","kind","qbo_id");--> statement-breakpoint
CREATE INDEX "project_unit_event_project" ON "project_unit_event" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_tag_company_kind_qbo" ON "qbo_tag" USING btree ("company_id","kind","qbo_id");