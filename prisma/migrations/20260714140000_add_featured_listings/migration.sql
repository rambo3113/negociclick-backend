-- Add reminder tracking field to businesses
ALTER TABLE "businesses" ADD COLUMN "featuredReminderSentAt" TIMESTAMP(3);
