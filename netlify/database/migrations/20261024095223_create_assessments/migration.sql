CREATE TABLE "assessments" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"child" text DEFAULT '' NOT NULL,
	"age_months" double precision NOT NULL,
	"weight_kg" double precision NOT NULL,
	"height_cm" double precision NOT NULL,
	"muac_cm" double precision NOT NULL,
	"bmi" double precision NOT NULL,
	"status" text NOT NULL,
	"confidence" double precision NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assessments_user_id_idx" ON "assessments" ("user_id");