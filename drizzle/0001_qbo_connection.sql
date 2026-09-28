CREATE TABLE "qbo_connection" (
	"company_id" text PRIMARY KEY NOT NULL,
	"realm_id" text NOT NULL,
	"environment" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"access_token_expires_at" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"refresh_token_expires_at" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"connected_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "qbo_company_name" text;--> statement-breakpoint
ALTER TABLE "qbo_connection" ADD CONSTRAINT "qbo_connection_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_qbo_realm_live" ON "company" USING btree ("qbo_realm_id") WHERE "company"."deleted_at" is null;