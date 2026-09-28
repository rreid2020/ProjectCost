CREATE TABLE "qbo_import_run" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"since" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"summary" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "qbo_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"qbo_txn_type" text NOT NULL,
	"qbo_txn_id" text NOT NULL,
	"doc_number" text,
	"date" text NOT NULL,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "qbo_project_mode" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "qbo_last_import_at" text;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD COLUMN "qbo_txn_type" text;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD COLUMN "qbo_customer_name" text;--> statement-breakpoint
ALTER TABLE "qbo_import_run" ADD CONSTRAINT "qbo_import_run_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_invoice" ADD CONSTRAINT "qbo_invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_invoice" ADD CONSTRAINT "qbo_invoice_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qbo_import_run_company_started" ON "qbo_import_run" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_invoice_company_txn" ON "qbo_invoice" USING btree ("company_id","qbo_txn_type","qbo_txn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_code_company_qbo" ON "cost_code" USING btree ("company_id","qbo_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_transaction_company_qbo" ON "cost_transaction" USING btree ("company_id","qbo_txn_type","qbo_txn_id","qbo_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_company_qbo" ON "customer" USING btree ("company_id","qbo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_company_qbo" ON "employee" USING btree ("company_id","qbo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_company_qbo" ON "project" USING btree ("company_id","qbo_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entry_company_qbo" ON "time_entry" USING btree ("company_id","qbo_time_activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_company_qbo" ON "vendor" USING btree ("company_id","qbo_id");