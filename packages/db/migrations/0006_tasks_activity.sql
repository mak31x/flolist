CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"root_list_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"field" text,
	"old" jsonb,
	"new" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"root_list_id" uuid,
	"list_id" uuid,
	"parent_task_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"title_inline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"trash_root_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_type_check";--> statement-breakpoint
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_reference_check";--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "getting_started_seeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_root_list_id_lists_id_fk" FOREIGN KEY ("root_list_id") REFERENCES "public"."lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_root_list_id_lists_id_fk" FOREIGN KEY ("root_list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_entity_idx" ON "activity_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_events_workspace_id_idx" ON "activity_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tasks_root_list_id_idx" ON "tasks" USING btree ("root_list_id");--> statement-breakpoint
CREATE INDEX "tasks_list_id_idx" ON "tasks" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_trash_root_id_idx" ON "tasks" USING btree ("trash_root_id");--> statement-breakpoint
CREATE INDEX "tasks_workspace_id_idx" ON "tasks" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_task_id_unique" UNIQUE("task_id");--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_type_check" CHECK ("type" in ('task', 'paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'quote', 'divider', 'image', 'attachment', 'sublist'));--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_reference_check" CHECK (("blocks"."file_id" is null or "blocks"."type" in ('image', 'attachment')) and (("blocks"."sublist_id" is not null) = ("blocks"."type" = 'sublist')) and (("blocks"."task_id" is not null) = ("blocks"."type" = 'task')));