CREATE TABLE `budget_line` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cost_code_id` text NOT NULL,
	`original_cents` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cost_code_id`) REFERENCES `cost_code`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_project_code` ON `budget_line` (`project_id`,`cost_code_id`);--> statement-breakpoint
CREATE TABLE `change_order_line` (
	`id` text PRIMARY KEY NOT NULL,
	`change_order_id` text NOT NULL,
	`cost_code_id` text NOT NULL,
	`cost_cents` integer NOT NULL,
	FOREIGN KEY (`change_order_id`) REFERENCES `change_order`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cost_code_id`) REFERENCES `cost_code`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `change_order` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`contract_amount_cents` integer NOT NULL,
	`date_issued` text NOT NULL,
	`date_approved` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `co_project_number` ON `change_order` (`project_id`,`number`);--> statement-breakpoint
CREATE TABLE `company` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region` text DEFAULT 'CA' NOT NULL,
	`province` text,
	`fiscal_year_end_month` integer DEFAULT 12 NOT NULL,
	`closed_through` text,
	`qbo_realm_id` text,
	`qbo_connected_at` text,
	`default_holdback_bp` integer DEFAULT 1000 NOT NULL,
	`default_tax_bp` integer DEFAULT 1300 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_code` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`cost_type` text NOT NULL,
	`qbo_item_id` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_code_company_code` ON `cost_code` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `cost_transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text,
	`cost_code_id` text,
	`vendor_id` text,
	`date` text NOT NULL,
	`source` text NOT NULL,
	`doc_number` text,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`qbo_txn_id` text,
	`qbo_line_id` text,
	`assigned_at` text,
	`pending_push` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cost_code_id`) REFERENCES `cost_code`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customer` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`qbo_id` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employee` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`trade` text NOT NULL,
	`pay_rate_cents` integer NOT NULL,
	`burden_bp` integer NOT NULL,
	`bill_rate_cents` integer NOT NULL,
	`qbo_id` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `forecast` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cost_code_id` text NOT NULL,
	`etc_cents` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cost_code_id`) REFERENCES `cost_code`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forecast_project_code` ON `forecast` (`project_id`,`cost_code_id`);--> statement-breakpoint
CREATE TABLE `progress_bill_line` (
	`id` text PRIMARY KEY NOT NULL,
	`progress_bill_id` text NOT NULL,
	`sov_line_id` text NOT NULL,
	`this_period_cents` integer NOT NULL,
	FOREIGN KEY (`progress_bill_id`) REFERENCES `progress_bill`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sov_line_id`) REFERENCES `sov_line`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `progress_bill` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`period_end` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`qbo_invoice_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pb_project_number` ON `progress_bill` (`project_id`,`number`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`number` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`contract_type` text DEFAULT 'FIXED' NOT NULL,
	`original_contract_cents` integer NOT NULL,
	`holdback_bp` integer DEFAULT 1000 NOT NULL,
	`tax_bp` integer DEFAULT 1300 NOT NULL,
	`project_manager` text,
	`start_date` text,
	`end_date` text,
	`qbo_project_id` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_company_number` ON `project` (`company_id`,`number`);--> statement-breakpoint
CREATE TABLE `sov_line` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`description` text NOT NULL,
	`scheduled_value_cents` integer NOT NULL,
	`change_order_number` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`entity` text NOT NULL,
	`qbo_id` text,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`request_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `time_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`project_id` text NOT NULL,
	`cost_code_id` text NOT NULL,
	`date` text NOT NULL,
	`hours_x100` integer NOT NULL,
	`pay_rate_cents` integer NOT NULL,
	`burden_bp` integer NOT NULL,
	`bill_rate_cents` integer NOT NULL,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`notes` text,
	`qbo_time_activity_id` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cost_code_id`) REFERENCES `cost_code`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `vendor` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`qbo_id` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `wip_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`period_end` text NOT NULL,
	`contract_cents` integer NOT NULL,
	`eac_cents` integer NOT NULL,
	`cost_to_date_cents` integer NOT NULL,
	`pct_complete_bp` integer NOT NULL,
	`earned_cents` integer NOT NULL,
	`billed_cents` integer NOT NULL,
	`over_under_cents` integer NOT NULL,
	`loss_provision_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wip_project_period` ON `wip_snapshot` (`project_id`,`period_end`);