import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/authConstants";

// /sso・/api/sso/ は「これからセッションを確立する」入口なので必ず公開（未ログインで到達するため）。
// これを塞ぐと iframe 埋め込みのワンタイムSSOが /login に飛ばされ、永久にログイン状態にならない。
// /api/wp/ は WordPress プラグインからの未認証リクエスト（自動登録）。所有確認はエンドポイント内でdiagコールバックにより担保。
// /api/schedule/tick は Vercel Cron からの呼び出し。CRON_SECRET による認可をエンドポイント内で行う。
const PUBLIC_PATHS = ["/login", "/sso", "/api/sso/", "/api/wp/", "/api/auth/", "/api/analyst/recommendations", "/api/schedule/tick"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";

  if (isPublic) return NextResponse.next();

  const session = req.cookies.get(sessionCookieName);
  if (!session?.value) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
