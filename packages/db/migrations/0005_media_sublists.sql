ALTER TABLE "blocks" DROP CONSTRAINT "blocks_type_check";--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "sublist_id" uuid;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_parent_block_id_blocks_id_fk" FOREIGN KEY ("parent_block_id") REFERENCES "public"."blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_sublist_id_lists_id_fk" FOREIGN KEY ("sublist_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_file_id_idx" ON "blocks" USING btree ("file_id");--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_sublist_id_unique" UNIQUE("sublist_id");--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_reference_check" CHECK (("blocks"."file_id" is null or "blocks"."type" in ('image', 'attachment')) and (("blocks"."sublist_id" is not null) = ("blocks"."type" = 'sublist')));--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_type_check" CHECK ("type" in ('paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'quote', 'divider', 'image', 'attachment', 'sublist'));