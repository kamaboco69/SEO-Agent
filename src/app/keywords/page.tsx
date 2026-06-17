"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Loader2, BookmarkPlus, X } from "lucide-react";

// ─── Types ───────────────────────────────────────────
interface KwResult { keyword: string; volume: number; difficulty: number; cpc: number; intent: string; isMain: boolean; source: string; }
interface KwData { keyword: string; mainMetrics: { volume: number; difficulty: number; cpc: number; intent: string }; results: KwResult[]; questions: string[]; relatedTopics: string[]; }

interface FNode {
  id: string; label: string; tailLabel: string; volume: number; difficulty: number; cpc: number; intent: string;
  isMain: boolean; x: number; y: number; vx: number; vy: number; r: number; color: string;
}

// ─── Constants ───────────────────────────────────────
const INTENT_COLOR: Record<string, string> = {
  "購買": "#38bdf8",
  "情報収集": "#a78bfa",
  "解決策": "#34d399",
  "比較検討": "#fb923c",
};
const DEFAULT_COLOR = "#22d3ee";

function getColor(intent: string) { return INTENT_COLOR[intent] ?? DEFAULT_COLOR; }

function volToR(vol: number, max: number): number {
  if (max === 0) return 18;
  return 14 + 40 * Math.pow(Math.max(vol, 0) / max, 0.42);
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// ─── Node builder ────────────────────────────────────

/** メインキーワードを除いたテール部分だけ抽出する */
function getTailLabel(full: string, mainKw: string): string {
  const f = full.trim();
  const m = mainKw.trim();
  // スペースあり ("コンテンツマーケティング おすすめ" → "おすすめ")
  if (f.toLowerCase().startsWith(m.toLowerCase() + " ")) {
    const tail = f.slice(m.length).trim();
    if (tail) return tail;
  }
  // スペースなし ("コンテンツマーケティングとは" → "とは")
  if (f.toLowerCase().startsWith(m.toLowerCase())) {
    const tail = f.slice(m.length).trim();
    if (tail) return tail;
  }
  // 後ろにメインKWがある ("おすすめ コンテンツマーケティング" → "おすすめ")
  if (f.toLowerCase().endsWith(" " + m.toLowerCase())) {
    const tail = f.slice(0, f.length - m.length).trim();
    if (tail) return tail;
  }
  // テールが取れない場合は先頭5文字まで
  return f.length > 6 ? f.slice(0, 5) + "…" : f;
}

function buildNodes(data: KwData, W: number, H: number): FNode[] {
  const cx = W / 2, cy = H / 2;
  const top = data.results.slice(0, 48);
  const maxVol = Math.max(...top.map(r => r.volume), data.mainMetrics.volume, 1);
  const mainR = volToR(data.mainMetrics.volume, maxVol);
  // 初期配置は画面の37%半径の円上（物理シミュで広がる）
  const initR = Math.min(W, H) * 0.37;

  const nodes: FNode[] = [{
    id: "__main__", label: data.keyword, tailLabel: data.keyword,
    volume: data.mainMetrics.volume, difficulty: data.mainMetrics.difficulty,
    cpc: data.mainMetrics.cpc, intent: data.mainMetrics.intent,
    isMain: true, x: cx, y: cy, vx: 0, vy: 0,
    r: Math.max(mainR, 34), color: "#38bdf8",
  }];

  const n = top.length;
  top.forEach((kw, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    nodes.push({
      id: kw.keyword, label: kw.keyword,
      tailLabel: getTailLabel(kw.keyword, data.keyword),
      volume: kw.volume, difficulty: kw.difficulty, cpc: kw.cpc, intent: kw.intent,
      isMain: false,
      x: cx + Math.cos(angle) * initR,
      y: cy + Math.sin(angle) * initR,
      vx: 0, vy: 0,
      r: Math.max(volToR(kw.volume, maxVol), 14),
      color: getColor(kw.intent),
    });
  });
  return nodes;
}

/** 事前に物理シミュを同期実行して最終配置を決定（RAF外・描画なし） */
function preSimulate(nodes: FNode[], W: number, H: number): FNode[] {
  const ns = nodes.map(n => ({ ...n }));
  const cx = W / 2, cy = H / 2;
  const REPEL = 8000, ATTRACT = 0.055, DAMP = 0.9;

  for (let iter = 0; iter < 1000; iter++) {
    for (let i = 1; i < ns.length; i++) {
      let fx = 0, fy = 0;
      // ノード間反発
      for (let j = 0; j < ns.length; j++) {
        if (i === j) continue;
        const dx = ns[i].x - ns[j].x, dy = ns[i].y - ns[j].y;
        const d2 = Math.max(dx * dx + dy * dy, 1), d = Math.sqrt(d2);
        const minD = ns[i].r + ns[j].r + 14;
        fx += (dx / d) * (d < minD ? REPEL * 6 / d2 : REPEL / d2);
        fy += (dy / d) * (d < minD ? REPEL * 6 / d2 : REPEL / d2);
      }
      // 中心からの目標距離スプリング（画面外縁まで広がるよう大きめ）
      const dx = ns[i].x - cx, dy = ns[i].y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) {
        const targetD = ns[0].r + ns[i].r + 130;
        const stretch = d - targetD;
        fx -= ATTRACT * stretch * (dx / d);
        fy -= ATTRACT * stretch * (dy / d);
      }
      ns[i].vx = (ns[i].vx + fx) * DAMP;
      ns[i].vy = (ns[i].vy + fy) * DAMP;
      ns[i].x = Math.max(ns[i].r + 10, Math.min(W - ns[i].r - 10, ns[i].x + ns[i].vx));
      ns[i].y = Math.max(ns[i].r + 10, Math.min(H - ns[i].r - 10, ns[i].y + ns[i].vy));
    }
  }
  return ns;
}

// ─── Canvas draw ─────────────────────────────────────
function drawGraph(
  ctx: CanvasRenderingContext2D,
  nodes: FNode[], W: number, H: number,
  hoveredId: string | null, selectedId: string | null
) {
  ctx.clearRect(0, 0, W, H);
  const main = nodes[0];

  // Edges
  for (let i = 1; i < nodes.length; i++) {
    const nd = nodes[i];
    const dx = nd.x - main.x, dy = nd.y - main.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) continue;
    const ux = dx / d, uy = dy / d;
    const sx = main.x + ux * main.r, sy = main.y + uy * main.r;
    const ex = nd.x - ux * nd.r, ey = nd.y - uy * nd.r;

    const alpha = 0.08 + 0.14 * Math.sqrt(nd.volume / main.volume);
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
    ctx.strokeStyle = `rgba(56,189,248,${Math.min(alpha, 0.28)})`;
    ctx.lineWidth = 0.8; ctx.stroke();

    // Arrowhead
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 5 * Math.cos(angle - 0.45), ey - 5 * Math.sin(angle - 0.45));
    ctx.lineTo(ex - 5 * Math.cos(angle + 0.45), ey - 5 * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fillStyle = `rgba(56,189,248,${Math.min(alpha * 2, 0.35)})`; ctx.fill();
  }

  // Nodes
  for (const nd of nodes) {
    const isHov = nd.id === hoveredId;
    const isSel = nd.id === selectedId;
    const [r, g, b] = hexToRgb(nd.color);

    // 広がるソフトグロー（外側ハロー）
    const glowR = nd.r * (isSel ? 2.4 : isHov ? 2.1 : 1.8);
    const glowGrad = ctx.createRadialGradient(nd.x, nd.y, nd.r * 0.4, nd.x, nd.y, glowR);
    glowGrad.addColorStop(0, `rgba(${r},${g},${b},${isSel ? 0.22 : isHov ? 0.15 : 0.1})`);
    glowGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath(); ctx.arc(nd.x, nd.y, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad; ctx.fill();

    // メイン塗り — 淡く透過
    const grad = ctx.createRadialGradient(nd.x - nd.r * 0.3, nd.y - nd.r * 0.3, 0, nd.x, nd.y, nd.r);
    grad.addColorStop(0,   `rgba(${r},${g},${b},0.55)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},0.32)`);
    grad.addColorStop(1,   `rgba(${r},${g},${b},0.15)`);

    ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.shadowBlur = isSel ? 30 : isHov ? 20 : 12;
    ctx.shadowColor = nd.color;
    ctx.fill(); ctx.shadowBlur = 0;

    // 細い輝縁
    ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r},${g},${b},${isSel ? 0.9 : isHov ? 0.7 : 0.45})`;
    ctx.lineWidth = isSel ? 1.5 : 0.8; ctx.stroke();

    // Labels
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";

    if (nd.isMain) {
      ctx.font = `bold 10px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(nd.volume.toLocaleString(), nd.x, nd.y - 11);
      ctx.font = `bold 12px -apple-system, sans-serif`;
      ctx.fillStyle = "#fff";
      drawWrappedText(ctx, nd.tailLabel, nd.x, nd.y + 5, nd.r * 1.6, 13);
    } else {
      // テールラベル（短い）を大きめフォントで中央に表示
      const fs = Math.max(9, Math.min(12, nd.r * 0.62));
      ctx.font = `bold ${fs}px -apple-system, sans-serif`;
      ctx.fillStyle = "#fff";
      drawWrappedText(ctx, nd.tailLabel, nd.x, nd.y - (nd.r > 22 ? 5 : 2), nd.r * 1.9, fs + 1);
      if (nd.r > 20) {
        ctx.font = `${Math.max(7, fs - 2)}px -apple-system, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.fillText(nd.volume.toLocaleString(), nd.x, nd.y + (nd.r > 24 ? 9 : 6));
      }
    }
  }
}

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number) {
  if (ctx.measureText(text).width <= maxW) { ctx.fillText(text, x, y); return; }
  const mid = Math.ceil(text.length / 2);
  ctx.fillText(text.slice(0, mid), x, y - lineH / 2);
  ctx.fillText(text.slice(mid), x, y + lineH / 2);
}

// ─── Page ────────────────────────────────────────────
export default function KeywordsPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<KwData | null>(null);
  const [savedKws, setSavedKws] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<FNode | null>(null);
  const [sortBy, setSortBy] = useState<"volume" | "difficulty" | "cpc">("volume");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<FNode[]>([]);
  const animRef = useRef<number>(0);
  const hoveredIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const dimRef = useRef<{ W: number; H: number }>({ W: 0, H: 0 });

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSelectedNode(null);
    selectedIdRef.current = null;
    try {
      const res = await fetch(`/api/keywords?q=${encodeURIComponent(query.trim())}`);
      setData(await res.json());
    } finally { setLoading(false); }
  }

  // 事前シミュ → ease-out補間で展開
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    cancelAnimationFrame(animRef.current);

    function init() {
      if (!canvas) return;
      const W = canvas.offsetWidth, H = canvas.offsetHeight;
      if (W < 10 || H < 10) { animRef.current = requestAnimationFrame(init); return; }
      canvas.width = W; canvas.height = H;
      dimRef.current = { W, H };

      // 初期配置（円上）
      const initNodes = buildNodes(data!, W, H);
      // 開始位置を記録（補間のfrom）
      const startPos = initNodes.map(n => ({ x: n.x, y: n.y }));
      // 物理シミュ事前実行（描画なし・同期）→ 最終配置
      const finalNodes = preSimulate(initNodes, W, H);
      nodesRef.current = finalNodes;

      const ANIM_FRAMES = 90; // ≈1.5秒でヌルっと展開
      let frame = 0;

      function loop() {
        const ctx = canvas!.getContext("2d");
        if (!ctx) return;

        let displayNodes: FNode[];
        if (frame < ANIM_FRAMES) {
          const t = frame / ANIM_FRAMES;
          // ease-out cubic（最初速く→末尾ゆっくり止まる）
          const e = 1 - Math.pow(1 - t, 3);
          displayNodes = finalNodes.map((n, i) => ({
            ...n,
            x: startPos[i].x + (n.x - startPos[i].x) * e,
            y: startPos[i].y + (n.y - startPos[i].y) * e,
          }));
          frame++;
        } else {
          displayNodes = finalNodes;
        }

        const { W: cW, H: cH } = dimRef.current;
        drawGraph(ctx, displayNodes, cW, cH, hoveredIdRef.current, selectedIdRef.current);
        animRef.current = requestAnimationFrame(loop);
      }
      animRef.current = requestAnimationFrame(loop);
    }

    animRef.current = requestAnimationFrame(init);
    return () => cancelAnimationFrame(animRef.current);
  }, [data]);

  // Canvas interactions
  function hitTest(x: number, y: number): FNode | null {
    const ns = nodesRef.current;
    for (let i = ns.length - 1; i >= 0; i--) {
      if (Math.hypot(ns[i].x - x, ns[i].y - y) <= ns[i].r) return ns[i];
    }
    return null;
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = dimRef.current.W / rect.width;
    const scaleY = dimRef.current.H / rect.height;
    const nd = hitTest((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
    setSelectedNode(nd);
    selectedIdRef.current = nd?.id ?? null;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = dimRef.current.W / rect.width;
    const scaleY = dimRef.current.H / rect.height;
    const nd = hitTest((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
    hoveredIdRef.current = nd?.id ?? null;
    canvasRef.current!.style.cursor = nd ? "pointer" : "default";
  }

  const sorted = data
    ? [...data.results].sort((a, b) =>
        sortBy === "volume" ? b.volume - a.volume : sortBy === "difficulty" ? a.difficulty - b.difficulty : b.cpc - a.cpc
      )
    : [];

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 py-3.5 flex items-center gap-4" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div className="shrink-0">
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(34,211,238,0.7)" }}>KEYWORD MAP</p>
          <h1 className="text-base font-bold leading-tight" style={{ color: "var(--cyan)", textShadow: "0 0 12px rgba(34,211,238,0.5)" }}>キーワードネットワーク</h1>
        </div>
        <form onSubmit={search} className="flex gap-2 flex-1">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="メインキーワードを入力（例: コンテンツマーケティング）"
              className="cyber-input pl-9 pr-4 py-2 rounded-lg text-sm w-full" />
          </div>
          <button type="submit" disabled={loading || !query.trim()}
            className="cyber-btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40 shrink-0">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            調査する
          </button>
        </form>
        {data && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[9px] mr-1" style={{ color: "var(--text-muted)" }}>並び替え:</span>
            {(["volume", "difficulty", "cpc"] as const).map((s) => (
              <button key={s} onClick={() => setSortBy(s)} className="text-[9px] px-2 py-1 rounded transition-all"
                style={sortBy === s
                  ? { background: "rgba(56,189,248,0.2)", border: "1px solid rgba(56,189,248,0.4)", color: "var(--blue)" }
                  : { background: "transparent", border: "1px solid rgba(56,189,248,0.1)", color: "var(--text-muted)" }}>
                {s === "volume" ? "ボリューム" : s === "difficulty" ? "難易度" : "CPC"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left panel */}
        <div className="w-64 shrink-0 flex flex-col overflow-hidden" style={{ borderRight: "1px solid rgba(56,189,248,0.1)" }}>
          {!data && !loading && (
            <div className="flex flex-col items-center justify-center flex-1 px-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3"
                style={{ background: "radial-gradient(circle, rgba(34,211,238,0.08) 0%, transparent 70%)" }}>
                <Search size={22} style={{ color: "rgba(34,211,238,0.2)" }} />
              </div>
              <p className="text-xs text-center leading-relaxed" style={{ color: "var(--text-muted)" }}>
                キーワードを入力して<br />ネットワークを表示
              </p>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center flex-1">
              <Loader2 size={22} className="animate-spin" style={{ color: "var(--cyan)" }} />
            </div>
          )}
          {data && (
            <>
              {/* Main KW summary */}
              <div className="px-3 py-3 shrink-0" style={{ borderBottom: "1px solid rgba(56,189,248,0.08)" }}>
                <p className="text-[9px] font-bold tracking-wider mb-2" style={{ color: "rgba(34,211,238,0.7)" }}>「{data.keyword}」概要</p>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { label: "ボリューム", val: data.mainMetrics.volume.toLocaleString(), color: "var(--cyan)" },
                    { label: "難易度", val: String(data.mainMetrics.difficulty), color: "#fb923c" },
                    { label: "CPC", val: `¥${data.mainMetrics.cpc}`, color: "#34d399" },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="text-center p-1.5 rounded-lg" style={{ background: "rgba(56,189,248,0.04)", border: "1px solid rgba(56,189,248,0.1)" }}>
                      <p className="text-[8px]" style={{ color: "var(--text-muted)" }}>{label}</p>
                      <p className="text-xs font-bold" style={{ color }}>{val}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Keyword list */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-3 py-1.5 sticky top-0 z-10" style={{ background: "rgba(2,8,24,0.95)", borderBottom: "1px solid rgba(56,189,248,0.06)" }}>
                  <p className="text-[9px] font-bold tracking-wider" style={{ color: "var(--text-muted)" }}>
                    関連キーワード <span style={{ color: "var(--blue)" }}>({data.results.length})</span>
                  </p>
                </div>
                {sorted.map((kw) => {
                  const color = INTENT_COLOR[kw.intent] ?? DEFAULT_COLOR;
                  const isSel = selectedNode?.id === kw.keyword;
                  return (
                    <div key={kw.keyword}
                      className="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-all"
                      style={{
                        background: isSel ? "rgba(56,189,248,0.05)" : "transparent",
                        borderLeft: `2px solid ${isSel ? "var(--blue)" : "transparent"}`,
                        borderBottom: "1px solid rgba(56,189,248,0.04)",
                      }}
                      onClick={() => {
                        const nd = nodesRef.current.find(n => n.id === kw.keyword) ?? null;
                        setSelectedNode(nd); selectedIdRef.current = nd?.id ?? null;
                      }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="flex-1 min-w-0 text-[11px] truncate" style={{ color: isSel ? "var(--blue)" : "var(--text-dim)" }}>
                        {kw.keyword}
                      </span>
                      <span className="text-[9px] font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
                        {kw.volume.toLocaleString()}
                      </span>
                      <button onClick={(ev) => { ev.stopPropagation(); setSavedKws(p => p.includes(kw.keyword) ? p.filter(k => k !== kw.keyword) : [...p, kw.keyword]); }}
                        style={{ color: savedKws.includes(kw.keyword) ? "var(--blue)" : "rgba(100,116,139,0.25)", flexShrink: 0 }}>
                        <BookmarkPlus size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Right: Canvas */}
        <div className="flex-1 relative overflow-hidden">
          {!data && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="w-48 h-48 rounded-full mb-4"
                style={{ background: "radial-gradient(circle, rgba(34,211,238,0.04) 0%, transparent 70%)", animation: "pulse-glow 4s ease-in-out infinite" }} />
              <p className="text-sm" style={{ color: "rgba(100,116,139,0.3)" }}>キーワードネットワークがここに表示されます</p>
            </div>
          )}

          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ display: data ? "block" : "none" }}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
          />

          {/* Legend */}
          {data && (
            <div className="absolute bottom-4 left-4 p-3 rounded-xl"
              style={{ background: "rgba(2,8,24,0.85)", border: "1px solid rgba(56,189,248,0.12)", backdropFilter: "blur(12px)" }}>
              <p className="text-[8px] font-bold tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>SEARCH INTENT</p>
              <div className="space-y-1">
                {Object.entries(INTENT_COLOR).map(([intent, color]) => (
                  <div key={intent} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{intent}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(56,189,248,0.08)" }}>
                <p className="text-[8px]" style={{ color: "rgba(100,116,139,0.45)" }}>○ サイズ = 検索ボリューム</p>
              </div>
            </div>
          )}

          {/* Node detail panel */}
          {selectedNode && (
            <div className="absolute top-4 right-4 w-60 rounded-xl p-4 z-10"
              style={{
                background: "rgba(2,8,24,0.93)",
                border: `1px solid ${selectedNode.color}50`,
                backdropFilter: "blur(20px)",
                boxShadow: `0 0 28px ${selectedNode.color}18`,
              }}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-[9px] font-bold tracking-widest mb-0.5" style={{ color: selectedNode.color }}>
                    {selectedNode.isMain ? "MAIN KEYWORD" : selectedNode.intent.toUpperCase()}
                  </p>
                  <p className="text-sm font-bold leading-snug" style={{ color: "var(--text)" }}>{selectedNode.label}</p>
                </div>
                <button onClick={() => { setSelectedNode(null); selectedIdRef.current = null; }}
                  className="shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
                  <X size={13} />
                </button>
              </div>

              <div className="space-y-2 mb-3">
                {[
                  { label: "月間ボリューム", val: selectedNode.volume.toLocaleString(), color: selectedNode.color },
                  { label: "SEO難易度", val: String(selectedNode.difficulty), color: selectedNode.difficulty >= 70 ? "#f87171" : selectedNode.difficulty >= 40 ? "#fb923c" : "#34d399" },
                  { label: "推定CPC", val: `¥${selectedNode.cpc.toLocaleString()}`, color: "var(--text-dim)" },
                ].map(({ label, val, color }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</span>
                    <span className="text-sm font-bold" style={{ color }}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Difficulty bar */}
              <div className="h-1 rounded-full overflow-hidden mb-3" style={{ background: "rgba(56,189,248,0.1)" }}>
                <div className="h-full rounded-full" style={{
                  width: `${selectedNode.difficulty}%`,
                  background: selectedNode.difficulty >= 70 ? "#f87171" : selectedNode.difficulty >= 40 ? "#fb923c" : "#34d399",
                  boxShadow: `0 0 8px ${selectedNode.difficulty >= 70 ? "#f87171" : selectedNode.difficulty >= 40 ? "#fb923c" : "#34d399"}`,
                }} />
              </div>

              <button
                onClick={() => { setQuery(selectedNode.label); }}
                className="w-full py-1.5 rounded-lg text-[10px] font-bold transition-all"
                style={{ background: `${selectedNode.color}15`, border: `1px solid ${selectedNode.color}35`, color: selectedNode.color }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `${selectedNode.color}25`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = `${selectedNode.color}15`; }}
              >
                このキーワードで再調査 →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
