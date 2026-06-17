-- AuthUser にメール/パスワードログイン用とAICompany連携トグル用のカラムを追加
ALTER TABLE "AuthUser" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "AuthUser" ADD COLUMN "aiCompanyLinkDisabled" BOOLEAN NOT NULL DEFAULT false;
