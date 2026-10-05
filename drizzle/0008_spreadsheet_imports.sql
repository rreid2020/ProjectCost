CREATE TABLE "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"sheet_name" text,
	"status" text NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"to_code" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"undone_at" text
);
--> statement-breakpoint
CREATE TABLE "import_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"mapping" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_upload" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"sheets" text NOT NULL,
	"sheet_index" integer DEFAULT 0 NOT NULL,
	"header_row" integer DEFAULT 0 NOT NULL,
	"mapping" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_line" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "qbo_invoice" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_upload" ADD CONSTRAINT "import_upload_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batch_company_created" ON "import_batch" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_mapping_company_kind" ON "import_mapping" USING btree ("company_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_transaction_company_ext" ON "cost_transaction" USING btree ("company_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entry_company_ext" ON "time_entry" USING btree ("company_id","external_ref");