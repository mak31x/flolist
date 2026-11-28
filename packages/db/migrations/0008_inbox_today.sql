CREATE TABLE "inbox_items" (
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"position" text collate "C" NOT NULL,
	"reason" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_items_user_id_task_id_pk" PRIMARY KEY("user_id","task_id"),
	CONSTRAINT "inbox_items_reason_check" CHECK ("reason" in ('assigned', 'manual', 'quick', 'integration'))
);
--> statement-breakpoint
CREATE TABLE "today_order" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"task_id" uuid NOT NULL,
	"position" text collate "C" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "today_order_user_id_date_task_id_pk" PRIMARY KEY("user_id","date","task_id")
);
--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "root_list_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "today_order" ADD CONSTRAINT "today_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "today_order" ADD CONSTRAINT "today_order_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_items_user_position_idx" ON "inbox_items" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "inbox_items_task_id_idx" ON "inbox_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "today_order_task_id_idx" ON "today_order" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_root_list_check" CHECK ("blocks"."root_list_id" is not null or "blocks"."container_type" = 'task');