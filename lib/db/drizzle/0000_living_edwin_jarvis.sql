CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_insights_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"record_id" text NOT NULL,
	"fields_hash" text NOT NULL,
	"severity" text NOT NULL,
	"text" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL,
	"pipeline_value" double precision DEFAULT 0 NOT NULL,
	"pipeline_count" integer DEFAULT 0 NOT NULL,
	"backlog_value" double precision DEFAULT 0 NOT NULL,
	"backlog_count" integer DEFAULT 0 NOT NULL,
	"open_demand_count" integer DEFAULT 0 NOT NULL,
	"bench_count" integer DEFAULT 0 NOT NULL,
	"over_allocated_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"user_guid" text NOT NULL,
	"alert_key" text NOT NULL,
	"status" text NOT NULL,
	"snoozed_until" timestamp with time zone,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"role" text,
	"user_guid" text,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "decision_acks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" text,
	"username" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synonym_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"canonical_field" text NOT NULL,
	"tab_type" text,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_jobs" (
	"upload_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"file_name" text NOT NULL,
	"s3_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_inserted" integer,
	"total_errors" integer,
	"result" json,
	"sheets" json
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_insights_cache_kind_record_idx" ON "card_insights_cache" USING btree ("kind","record_id");--> statement-breakpoint
CREATE INDEX "card_insights_cache_expires_at_idx" ON "card_insights_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_snapshots_tenant_date_idx" ON "forecast_snapshots" USING btree ("tenant","snapshot_date");--> statement-breakpoint
CREATE INDEX "forecast_snapshots_date_idx" ON "forecast_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_state_tenant_user_key_idx" ON "alert_state" USING btree ("tenant","user_guid","alert_key");--> statement-breakpoint
CREATE INDEX "alert_state_user_idx" ON "alert_state" USING btree ("tenant","user_guid");--> statement-breakpoint
CREATE INDEX "ai_escalations_tenant_status_idx" ON "ai_escalations" USING btree ("tenant","status");--> statement-breakpoint
CREATE INDEX "ai_escalations_generated_at_idx" ON "ai_escalations" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "decision_acks_user_idx" ON "decision_acks" USING btree ("username","kind");--> statement-breakpoint
CREATE INDEX "decision_acks_ref_idx" ON "decision_acks" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "synonym_alias_tab_idx" ON "synonym_mappings" USING btree ("alias","tab_type");