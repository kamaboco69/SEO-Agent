-- メディアのWordPress接続情報
ALTER TABLE "Media" ADD COLUMN "wpUrl" TEXT;
ALTER TABLE "Media" ADD COLUMN "wpSecret" TEXT;
ALTER TABLE "Media" ADD COLUMN "wpConnectedAt" TIMESTAMP(3);

-- ワークフローのWordPress投稿情報
ALTER TABLE "ContentWorkflow" ADD COLUMN "wpPostId" INTEGER;
ALTER TABLE "ContentWorkflow" ADD COLUMN "wpEditLink" TEXT;
ALTER TABLE "ContentWorkflow" ADD COLUMN "wpViewLink" TEXT;
ALTER TABLE "ContentWorkflow" ADD COLUMN "wpPublished" BOOLEAN NOT NULL DEFAULT false;
