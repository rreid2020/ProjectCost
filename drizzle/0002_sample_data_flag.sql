ALTER TABLE "company" ADD COLUMN "sample_data_loaded_at" text;--> statement-breakpoint
-- Workspaces that loaded sample data before this column existed
UPDATE "company" SET "sample_data_loaded_at" = l."created_at"
FROM (SELECT "company_id", min("created_at") AS "created_at" FROM "sync_log" WHERE "message" LIKE 'Sample data loaded%' GROUP BY "company_id") l
WHERE l."company_id" = "company"."id" AND "company"."sample_data_loaded_at" IS NULL;
