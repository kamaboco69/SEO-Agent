"use client";

import Link from "next/link";
import { Search, BarChart2, FileEdit, Link2, TrendingUp, Gauge, ArrowRight, Send, Newspaper } from "lucide-react";

const nodes = [
  {
    href: "/keywords",
    icon: Search,
    label: "KEYWORD SCANNER",
    sublabel: "キーワードリサーチ",
    desc: "Google Suggest + 検索ボリューム・難易度・CPC推定",
    color: "#22d3ee",
    glow: "rgba(34,211,238,0.25)",
    border: "rgba(34,211,238,0.35)",
    bg: "rgba(34,211,238,0.06)",
  },
  {
    href: "/serp",
    icon: BarChart2,
    label: "SERP ANALYZER",
    sublabel: "SERP分析",
    desc: "上位10サイト解析・必要文字数・共起語自動算出",
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.25)",
    border: "rgba(167,139,250,0.35)",
    bg: "rgba(167,139,250,0.06)",
  },
  {
    href: "/editor",
    icon: FileEdit,
    label: "CONTENT ENGINE",
    sublabel: "AIコンテンツエディタ",
    desc: "SEOスコアリアルタイム表示 × Claude記事自動生成",
    color: "#34d399",
    glow: "rgba(52,211,153,0.25)",
    border: "rgba(52,211,153,0.35)",
    bg: "rgba(52,211,153,0.06)",
  },
  {
    href: "/backlinks",
    icon: Link2,
    label: "LINK INTELLIGENCE",
    sublabel: "被リンク分析",
    desc: "参照ドメイン分析・推奨リンク獲得先リストアップ",
    color: "#fb923c",
    glow: "rgba(251,146,60,0.25)",
    border: "rgba(251,146,60,0.35)",
    bg: "rgba(251,146,60,0.06)",
  },
  {
    href: "/tracker",
    icon: TrendingUp,
    label: "RANK TRACKER",
    sublabel: "順位トラッカー",
    desc: "キーワード順位を継続追跡・変動グラフ可視化",
    color: "#38bdf8",
    glow: "rgba(56,189,248,0.25)",
    border: "rgba(56,189,248,0.35)",
    bg: "rgba(56,189,248,0.06)",
  },
  {
    href: "/audit",
    icon: Gauge,
    label: "SITE AUDITOR",
    sublabel: "サイト監査",
    desc: "技術SEO一括チェック・OGP・構造化データ診断",
    color: "#f472b6",
    glow: "rgba(244,114,182,0.25)",
    border: "rgba(244,114,182,0.35)",
    bg: "rgba(244,114,182,0.06)",
  },
  {
    href: "/media",
    icon: Newspaper,
    label: "MEDIA CONTENT OPS",
    sublabel: "メディア運用・記事制作",
    desc: "メディア登録からKW調査・構成提案・承認付き執筆まで一気通貫",
    color: "#22d3ee",
    glow: "rgba(34,211,238,0.25)",
    border: "rgba(34,211,238,0.35)",
    bg: "rgba(34,211,238,0.06)",
  },
  {
    href: "/analyst",
    icon: Send,
    label: "AICOMPANY CONNECTOR",
    sublabel: "SEOアナリスト連携",
    desc: "分析パッケージ生成・提案受信・外部アナリストへの引き継ぎ",
    color: "#34d399",
    glow: "rgba(52,211,153,0.25)",
    border: "rgba(52,211,153,0.35)",
    bg: "rgba(52,211,153,0.06)",
  },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div
        className="shrink-0 px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}
      >
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className="text-[10px] font-bold tracking-widest uppercase"
              style={{ color: "rgba(56,189,248,0.6)" }}
            >
              HOLOGRAPHIC SEO PLATFORM
            </span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded"
              style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}
            >
              ONLINE
            </span>
          </div>
          <h1 className="text-xl font-bold grad-text tracking-tight">
            SEO Agent — Next Generation Intelligence
          </h1>
        </div>
        <Link
          href="/keywords"
          className="cyber-btn-primary flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-lg"
        >
          <Search size={13} />
          SCAN KEYWORDS
        </Link>
      </div>

      {/* Main grid — fills remaining space */}
      <div className="flex-1 overflow-hidden p-4">
        <div
          className="h-full grid gap-3"
          style={{
            gridTemplateColumns: "repeat(4, 1fr)",
            gridTemplateRows: "repeat(2, 1fr)",
          }}
        >
          {nodes.map(({ href, icon: Icon, label, sublabel, desc, color, glow, border, bg }) => (
            <Link
              key={href}
              href={href}
              className="group relative rounded-xl overflow-hidden flex flex-col transition-all duration-300"
              style={{
                background: bg,
                border: `1px solid ${border.replace("0.35", "0.2")}`,
                backdropFilter: "blur(20px)",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.border = `1px solid ${border}`;
                el.style.boxShadow = `0 0 30px ${glow}, inset 0 0 30px ${glow.replace("0.25", "0.04")}`;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.border = `1px solid ${border.replace("0.35", "0.2")}`;
                el.style.boxShadow = "none";
              }}
            >
              {/* Top glow line */}
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: 0.6 }}
              />

              {/* Corner accent */}
              <div
                className="absolute top-0 right-0 w-16 h-16 opacity-10"
                style={{
                  background: `radial-gradient(circle at top right, ${color}, transparent)`,
                }}
              />

              <div className="flex flex-col h-full p-4 z-10">
                {/* Icon + label */}
                <div className="flex items-start justify-between mb-auto">
                  <div>
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center mb-2.5"
                      style={{
                        background: `rgba(${color.slice(1).match(/.{2}/g)!.map(h => parseInt(h, 16)).join(",")}, 0.15)`,
                        border: `1px solid ${border}`,
                      }}
                    >
                      <Icon size={16} style={{ color }} />
                    </div>
                    <p
                      className="text-[10px] font-bold tracking-widest mb-0.5"
                      style={{ color: color, opacity: 0.8 }}
                    >
                      {label}
                    </p>
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      {sublabel}
                    </p>
                  </div>
                  <ArrowRight
                    size={14}
                    className="opacity-0 group-hover:opacity-100 transition-opacity mt-1"
                    style={{ color }}
                  />
                </div>

                {/* Description */}
                <p className="text-xs leading-relaxed mt-3" style={{ color: "var(--text-muted)" }}>
                  {desc}
                </p>

                {/* Bottom bar */}
                <div
                  className="mt-3 pt-2.5"
                  style={{ borderTop: `1px solid ${border.replace("0.35","0.15")}` }}
                >
                  <div className="flex items-center gap-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full pulse-glow"
                      style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                    />
                    <span className="text-[10px]" style={{ color: "rgba(100,116,139,0.8)" }}>
                      SYSTEM READY
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer strip */}
      <div
        className="shrink-0 px-6 py-2 flex items-center gap-6"
        style={{ borderTop: "1px solid rgba(56,189,248,0.08)" }}
      >
        {[
          { label: "GOOGLE SUGGEST", status: "ACTIVE", ok: true },
          { label: "SERP ENGINE", status: "DEMO MODE", ok: false },
          { label: "CLAUDE AI", status: "STANDBY", ok: false },
          { label: "BACKLINK DB", status: "DEMO MODE", ok: false },
        ].map(({ label, status, ok }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: ok ? "#34d399" : "rgba(56,189,248,0.4)",
                boxShadow: ok ? "0 0 6px #34d399" : "none",
              }}
            />
            <span className="text-[9px] font-medium" style={{ color: "var(--text-muted)" }}>
              {label}
            </span>
            <span
              className="text-[9px]"
              style={{ color: ok ? "#34d399" : "rgba(56,189,248,0.5)" }}
            >
              [{status}]
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
