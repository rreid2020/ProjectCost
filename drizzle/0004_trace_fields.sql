ALTER TABLE "cost_transaction" ADD COLUMN "qbo_currency" text;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD COLUMN "qbo_line_amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "cost_transaction" ADD COLUMN "qbo_exchange_rate" text;--> statement-breakpoint
ALTER TABLE "qbo_invoice" ADD COLUMN "total_cents" bigint;--> statement-breakpoint
ALTER TABLE "qbo_invoice" ADD COLUMN "tax_cents" bigint;--> statement-breakpoint
ALTER TABLE "qbo_invoice" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "qbo_invoice" ADD COLUMN "exchange_rate" text;