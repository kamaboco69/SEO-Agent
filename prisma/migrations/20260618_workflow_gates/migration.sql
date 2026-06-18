-- 段階実行（記事選択・承認2ゲート）用のフィールド
ALTER TABLE "ContentWorkflow" ADD COLUMN "selectedArticle" TEXT;
ALTER TABLE "ContentWorkflow" ADD COLUMN "approved1" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ContentWorkflow" ADD COLUMN "approved2" BOOLEAN NOT NULL DEFAULT false;
