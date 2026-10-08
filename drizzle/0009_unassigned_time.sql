ALTER TABLE "time_entry" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "qbo_customer_name" text;