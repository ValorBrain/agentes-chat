ALTER TABLE "channels" ALTER COLUMN "reply_in_threads" DROP NOT NULL;--> statement-breakpoint
-- deploy-safe: the running version inserts channels without this column and reads null as off, the main timeline, which is what the new rule gives a channel until two people are in it
ALTER TABLE "channels" ALTER COLUMN "reply_in_threads" DROP DEFAULT;--> statement-breakpoint
UPDATE "channels" SET "reply_in_threads" = NULL WHERE "reply_in_threads";
