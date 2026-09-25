CREATE TABLE "budget_line" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"cost_code_id" text NOT NULL,
	"original_cents" bigint NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "change_order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"change_order_id" text NOT NULL,
	"cost_code_id" text NOT NULL,
	"cost_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_order" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"contract_amount_cents" bigint NOT NULL,
	"date_issued" text NOT NULL,
	"date_approved" text,
	CONSTRAINT "change_order_tenant" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" text PRIMARY KEY NOT NULL,
	"clerk_org_id" text,
	"name" text NOT NULL,
	"region" text DEFAULT 'CA' NOT NULL,
	"province" text,
	"fiscal_year_end_month" integer DEFAULT 12 NOT NULL,
	"closed_through" text,
	"qbo_realm_id" text,
	"qbo_connected_at" text,
	"default_holdback_bp" integer DEFAULT 1000 NOT NULL,
	"default_tax_bp" integer DEFAULT 1300 NOT NULL,
	"created_at" text NOT NULL,
	"deleted_at" text,
	"trial_ends_at" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan" text,
	"subscription_status" text,
	"current_period_end" text,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	CONSTRAINT "company_clerk_org_id_unique" UNIQUE("clerk_org_id"),
	CONSTRAINT "company_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "company_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "cost_code" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"cost_type" text NOT NULL,
	"qbo_item_id" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cost_code_tenant" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "cost_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text,
	"cost_code_id" text,
	"vendor_id" text,
	"date" text NOT NULL,
	"source" text NOT NULL,
	"doc_number" text,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"qbo_txn_id" text,
	"qbo_line_id" text,
	"assigned_at" text,
	"pending_push" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"qbo_id" text,
	CONSTRAINT "customer_tenant" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "employee" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"trade" text NOT NULL,
	"pay_rate_cents" integer NOT NULL,
	"burden_bp" integer NOT NULL,
	"bill_rate_cents" integer NOT NULL,
	"qbo_id" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "employee_tenant" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "forecast" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"cost_code_id" text NOT NULL,
	"etc_cents" bigint NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_bill_line" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"progress_bill_id" text NOT NULL,
	"sov_line_id" text NOT NULL,
	"this_period_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_bill" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"period_end" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"qbo_invoice_id" text,
	CONSTRAINT "progress_bill_tenant" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"contract_type" text DEFAULT 'FIXED' NOT NULL,
	"original_contract_cents" bigint NOT NULL,
	"holdback_bp" integer DEFAULT 1000 NOT NULL,
	"tax_bp" integer DEFAULT 1300 NOT NULL,
	"project_manager" text,
	"start_date" text,
	"end_date" text,
	"qbo_project_id" text,
	CONSTRAINT "project_tenant" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "sov_line" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"scheduled_value_cents" bigint NOT NULL,
	"change_order_number" integer,
	CONSTRAINT "sov_line_tenant" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity" text NOT NULL,
	"qbo_id" text,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"request_id" text,
	"user_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"project_id" text NOT NULL,
	"cost_code_id" text NOT NULL,
	"date" text NOT NULL,
	"hours_x100" integer NOT NULL,
	"pay_rate_cents" integer NOT NULL,
	"burden_bp" integer NOT NULL,
	"bill_rate_cents" integer NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"notes" text,
	"qbo_time_activity_id" text
);
--> statement-breakpoint
CREATE TABLE "vendor" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"qbo_id" text,
	CONSTRAINT "vendor_tenant" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "wip_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"period_end" text NOT NULL,
	"contract_cents" bigint NOT NULL,
	"eac_cents" bigint NOT NULL,
	"cost_to_date_cents" bigint NOT NULL,
	"pct_complete_bp" integer NOT NULL,
	"earned_cents" bigint NOT NULL,
	"billed_cents" bigint NOT NULL,
	"over_under_cents" bigint NOT NULL,
	"loss_provision_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_cost_code_fk" FOREIGN KEY ("company_id","cost_code_id") REFERENCES "public"."cost_code"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_line" ADD CONSTRAINT "change_order_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_line" ADD CONSTRAINT "change_order_line_co_fk" FOREIGN KEY ("company_id","change_order_id") REFERENCES "public"."change_order"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_line" ADD CONSTRAINT "change_order_line_cost_code_fk" FOREIGN KEY ("company_id","cost_code_id") REFERENCES "public"."cost_code"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order" ADD CONSTRAINT "change_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order" ADD CONSTRAINT "change_order_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_code" ADD CONSTRAINT "cost_code_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD CONSTRAINT "cost_transaction_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD CONSTRAINT "cost_transaction_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD CONSTRAINT "cost_transaction_cost_code_fk" FOREIGN KEY ("company_id","cost_code_id") REFERENCES "public"."cost_code"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD CONSTRAINT "cost_transaction_vendor_fk" FOREIGN KEY ("company_id","vendor_id") REFERENCES "public"."vendor"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast" ADD CONSTRAINT "forecast_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast" ADD CONSTRAINT "forecast_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast" ADD CONSTRAINT "forecast_cost_code_fk" FOREIGN KEY ("company_id","cost_code_id") REFERENCES "public"."cost_code"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_bill_line" ADD CONSTRAINT "progress_bill_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_bill_line" ADD CONSTRAINT "progress_bill_line_bill_fk" FOREIGN KEY ("company_id","progress_bill_id") REFERENCES "public"."progress_bill"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_bill_line" ADD CONSTRAINT "progress_bill_line_sov_fk" FOREIGN KEY ("company_id","sov_line_id") REFERENCES "public"."sov_line"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_bill" ADD CONSTRAINT "progress_bill_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_bill" ADD CONSTRAINT "progress_bill_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_customer_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customer"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sov_line" ADD CONSTRAINT "sov_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sov_line" ADD CONSTRAINT "sov_line_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_employee_fk" FOREIGN KEY ("company_id","employee_id") REFERENCES "public"."employee"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_cost_code_fk" FOREIGN KEY ("company_id","cost_code_id") REFERENCES "public"."cost_code"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wip_snapshot" ADD CONSTRAINT "wip_snapshot_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wip_snapshot" ADD CONSTRAINT "wip_snapshot_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."project"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_project_code" ON "budget_line" USING btree ("project_id","cost_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "co_project_number" ON "change_order" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_code_company_code" ON "cost_code" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "cost_transaction_company_project" ON "cost_transaction" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_project_code" ON "forecast" USING btree ("project_id","cost_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pb_project_number" ON "progress_bill" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "project_company_number" ON "project" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "sync_log_company_created" ON "sync_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "time_entry_company_status" ON "time_entry" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "time_entry_project" ON "time_entry" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wip_project_period" ON "wip_snapshot" USING btree ("project_id","period_end");