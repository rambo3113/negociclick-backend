-- Add manual trial fields to subscriptions
ALTER TABLE "subscriptions" ADD COLUMN "isManualTrial"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscriptions" ADD COLUMN "trialGrantedAt" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN "trialGrantedBy" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "trialReason"    TEXT;
