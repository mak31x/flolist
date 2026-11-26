CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"container_type" text NOT NULL,
	"container_id" uuid NOT NULL,
	"root_list_id" uuid NOT NULL,
	"position" text collate "C" NOT NULL,
	"type" text NOT NULL,
	"indent" smallint DEFAULT 0 NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"trash_root_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_container_type_check" CHECK ("blocks"."container_type" in ('list', 'task')),
	CONSTRAINT "blocks_type_check" CHECK ("type" in ('paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'quote', 'divider')),
	CONSTRAINT "blocks_indent_check" CHECK ("indent" between 0 and 4)
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_root_list_id_lists_id_fk" FOREIGN KEY ("root_list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_container_position_idx" ON "blocks" USING btree ("container_type","container_id","position") WHERE "blocks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "blocks_root_list_id_idx" ON "blocks" USING btree ("root_list_id");--> statement-breakpoint
CREATE INDEX "blocks_trash_root_id_idx" ON "blocks" USING btree ("trash_root_id");