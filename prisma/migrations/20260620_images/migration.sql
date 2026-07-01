-- 画像挿入後の最終HTMLと画像生成済みフラグ
ALTER TABLE "ContentWorkflow" ADD COLUMN "finalHtml" TEXT;
ALTER TABLE "ContentWorkflow" ADD COLUMN "imagesGenerated" BOOLEAN NOT NULL DEFAULT false;
