import { NextResponse } from "next/server";
import { enableAiCompanyLink, getCurrentUser, syncAiCompanyProfileByEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 既にログイン済みのユーザーが、自分のメールアドレスでAICompany設定を
// 手動で引き込む（自動連携の再実行）。
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "session_expired" }, { status: 401 });
  }

  if (!process.env.AI_COMPANY_PROFILE_URL) {
    return NextResponse.json({ ok: false, error: "AICompany連携が未設定です" }, { status: 503 });
  }

  // 解除フラグを戻してから再連携
  await enableAiCompanyLink(user.id);
  const linked = await syncAiCompanyProfileByEmail(user.id, user.email);
  if (!linked) {
    return NextResponse.json(
      { ok: false, error: "同じメールアドレスのAICompanyアカウントが見つかりませんでした" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
