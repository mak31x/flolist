CREATE TABLE "list_view_prefs" (
	"user_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"sort" text DEFAULT 'manual' NOT NULL,
	"hide_completed" boolean DEFAULT false NOT NULL,
	"tasks_only" boolean DEFAULT false NOT NULL,
	"last_opened_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_view_prefs_user_id_list_id_pk" PRIMARY KEY("user_id","list_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"root_list_id" uuid NOT NULL,
	"parent_list_id" uuid,
	"parent_block_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"emoji" text,
	"cover_file_id" uuid,
	"cover_builtin" text,
	"created_by" uuid NOT NULL,
	"link_access" text DEFAULT 'none' NOT NULL,
	"share_token" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"trash_root_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lists_share_token_unique" UNIQUE("share_token"),
	CONSTRAINT "lists_link_access_check" CHECK ("lists"."link_access" in ('none', 'view', 'edit')),
	CONSTRAINT "lists_root_check" CHECK (("lists"."parent_list_id" is null) = ("lists"."root_list_id" = "lists"."id"))
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" text NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sidebar_entries" (
	"user_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"position" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sidebar_entries_user_id_list_id_pk" PRIMARY KEY("user_id","list_id")
);
--> statement-breakpoint
CREATE TABLE "applied_mutations" (
	"user_id" uuid NOT NULL,
	"client_mutation_id" uuid NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applied_mutations_user_id_client_mutation_id_pk" PRIMARY KEY("user_id","client_mutation_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"channels" text[] NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "list_view_prefs" ADD CONSTRAINT "list_view_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_view_prefs" ADD CONSTRAINT "list_view_prefs_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_root_list_id_lists_id_fk" FOREIGN KEY ("root_list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_parent_list_id_lists_id_fk" FOREIGN KEY ("parent_list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_entries" ADD CONSTRAINT "sidebar_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_entries" ADD CONSTRAINT "sidebar_entries_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_entries" ADD CONSTRAINT "sidebar_entries_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applied_mutations" ADD CONSTRAINT "applied_mutations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_view_prefs_list_id_idx" ON "list_view_prefs" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "lists_workspace_id_idx" ON "lists" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "lists_created_by_idx" ON "lists" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "lists_root_list_id_idx" ON "lists" USING btree ("root_list_id");--> statement-breakpoint
CREATE INDEX "lists_trash_root_id_idx" ON "lists" USING btree ("trash_root_id");--> statement-breakpoint
CREATE INDEX "sections_user_id_idx" ON "sections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_default_unique" ON "sections" USING btree ("user_id") WHERE "sections"."is_default";--> statement-breakpoint
CREATE INDEX "sidebar_entries_section_id_idx" ON "sidebar_entries" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "sidebar_entries_list_id_idx" ON "sidebar_entries" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "applied_mutations_created_at_idx" ON "applied_mutations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("id") WHERE "outbox"."dispatched_at" is null;