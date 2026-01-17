// Buffer polyfill for Solana libraries - MUST be before any Solana imports
import { Buffer } from "buffer";
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}
// Also set on window for compatibility
if (typeof window !== "undefined" && typeof (window as any).Buffer === "undefined") {
  (window as any).Buffer = Buffer;
}

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import heic2any from "heic2any";
import { motion } from "framer-motion";
import {  
  Bot, 
  Wallet, 
  Play, 
  Heart, 
  X, 
  Sparkles, 
  Plus, 
  Twitter, 
  User,
  Paperclip
} from "lucide-react";

import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";



const LS = {
  AGENTS: "echo:agents:v1",
  LIKED: "echo:liked:v1",
  SAVED: "echo:saved:v1",
  PURCHASES: "echo:purchases:v1",
  REVIEWS: "echo:reviews:v1",
};

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveLS(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Log in development to help debug quota exceeded errors
    if (import.meta.env.DEV) {
      console.warn("Failed to save to localStorage:", e);
    }
  }
}




const SOLANA_NETWORK = "mainnet-beta" as const;
// ⚠️ TODO: сюда вставь mint USDC для нужной сети (devnet/mainnet)
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// RPC endpoints with fallback strategy
const RPC_ENDPOINTS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-api.projectserum.com",
  "https://rpc.ankr.com/solana",
  clusterApiUrl(SOLANA_NETWORK), // Fallback to clusterApiUrl
];

// Helper function to make RPC calls through /api/solana-rpc proxy
async function proxyRpcRequest(method: string, params: any[]): Promise<any> {
  const response = await fetch("/api/solana-rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method,
      params,
      id: Date.now(),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `RPC request failed: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || "RPC error");
  }

  return data.result;
}

// Get latest blockhash through proxy or direct connection
async function getLatestBlockhash(useProxy: boolean): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  if (useProxy) {
    // Solana JSON-RPC spec: params must be [{ commitment: "finalized" }] NOT ["finalized"]
    const result = await proxyRpcRequest("getLatestBlockhash", [{ commitment: "finalized" }]);
    return {
      blockhash: result.value.blockhash,
      lastValidBlockHeight: result.value.lastValidBlockHeight,
    };
  } else {
    // Try direct connection
    for (const endpoint of RPC_ENDPOINTS) {
      try {
        const connection = new Connection(endpoint, "confirmed");
        // web3.js accepts { commitment: "finalized" } object
        return await connection.getLatestBlockhash({ commitment: "finalized" });
      } catch (e: any) {
        console.warn(`RPC endpoint failed: ${endpoint}`, e?.message);
        continue;
      }
    }
    // If all direct endpoints fail, use proxy
    return getLatestBlockhash(true);
  }
}

// Get a working Solana connection - use proxy for getLatestBlockhash in production
async function getSolanaConnection(): Promise<Connection> {
  // In production (Vercel), use proxy for RPC calls to avoid 403 errors
  // In dev, try direct connection first
  const isProduction = typeof window !== "undefined" && 
    (window.location.hostname.includes("vercel.app") || 
     window.location.hostname.includes("vercel.com") ||
     import.meta.env.PROD);

  // For getLatestBlockhash, we'll use the proxy function directly
  // For other operations, try direct connection first
  if (isProduction) {
    // In production, use a connection but we'll override getLatestBlockhash calls
    // We'll handle this in the payment flow
    return new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  }

  // In dev, try direct endpoints first
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const connection = new Connection(endpoint, "confirmed");
      // Test the connection with a lightweight call
      await connection.getSlot();
      return connection;
    } catch (e: any) {
      console.warn(`RPC endpoint failed: ${endpoint}`, e?.message);
      continue;
    }
  }

  // If all direct endpoints fail in dev, use fallback
  console.error("All RPC endpoints failed, using fallback");
  return new Connection(RPC_ENDPOINTS[0], "confirmed");
}


/*
  Echo — Web3 AI Agent Marketplace
  Additions in this revision:
  • Fixes: removed stray code causing syntax errors and repaired JSX comment/quote issues.
  • Top Rated gradient borders (orange -> amber) on the best agents.
  • Button hover/press micro-interactions.
  • Smooth fade-in for cards.
  • Skeleton loaders while the grid initializes.
  • Working Profile menu pages: My Agents, Purchases, Creator Stats.
*/

const HOME_SCROLL_KEY = "echo_home_scroll";

const TRENDING_RESET_KEY = "echo_trending_reset_v1";

function rememberHomeScroll() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(HOME_SCROLL_KEY, String(window.scrollY));
}

function restoreHomeScrollOnce() {
  if (typeof window === "undefined") return;

  // First check exploreScrollY (saved when navigating from Explore to agent view)
  const exploreY = sessionStorage.getItem("exploreScrollY");
  if (exploreY) {
    const y = parseInt(exploreY, 10) || 0;
    // Delay scroll restoration to ensure DOM is ready
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: "auto" });
    });
    sessionStorage.removeItem("exploreScrollY");
    return;
  }

  // Fallback to HOME_SCROLL_KEY
  const raw = sessionStorage.getItem(HOME_SCROLL_KEY);
  if (!raw) return;

  const y = parseInt(raw, 10) || 0;

  // восстановили позицию
  window.scrollTo({ top: y, behavior: "auto" });

  // и сразу же удаляем — чтобы на F5 не прыгало
  sessionStorage.removeItem(HOME_SCROLL_KEY);
}


// --- Lightweight UI shims (no external deps) ---
const cx = (...c:any[]) => c.filter(Boolean).join(" ");
// --- Phantom provider helpers + real connect flow ---
function getPhantomProvider(): any | null {
  const w = window as any;
  if ("solana" in w) {
    const p = w.solana;
    if (p && p.isPhantom) return p;
  }
  return null;
}
const shorten = (pk: string) => (pk ? `${pk.slice(0, 4)}...${pk.slice(-4)}` : "");

// Реальное подключение/отключение Phantom
async function connectPhantom(
  setConnected: (b: boolean) => void,
  setAddress: (s: string | null) => void,
  setWalletPk: (s: string | null) => void
) {
  const provider = getPhantomProvider();
  if (!provider) {
    alert("Phantom wallet not found. Install Phantom wallet and try again.");
    return;
  }
  try {
    await provider.connect({ onlyIfTrusted: true }).catch(() => {});
    const res = provider.publicKey ? { publicKey: provider.publicKey } : await provider.connect();
    const pubkey = res?.publicKey?.toString?.() || "";
    setConnected(true);
    setWalletPk(pubkey);          // полный адрес
    setAddress(shorten(pubkey));  // короткий для отображения
  } catch (e) {
    console.error(e);
  }
}


async function disconnectPhantom(
  setConnected: (b: boolean) => void,
  setAddress: (s: string | null) => void,
  setWalletPk: (s: string | null) => void
) {
  const provider = getPhantomProvider();
  try { await provider?.disconnect?.(); } catch {}
  setConnected(false);
  setAddress(null);
  setWalletPk(null);
}


const Button = ({ className = "", variant = "primary", onClick, children, disabled, type = "button" as const }: any) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={cx(
      "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition will-change-transform focus:outline-none focus:ring-2 focus:ring-offset-2",
      variant === "secondary" ? "bg-white/10 hover:bg-white/20 text-white border border-white/10" : "bg-indigo-600 hover:bg-indigo-500 text-white",
      "active:scale-[0.98]", // press effect
      disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
      className
    )}
  >{children}</button>
);
const Card = ({ className = "", children }: any) =>
  <div className={cx("rounded-xl border border-white/10 bg-transparent", className)}>
    {children}
  </div>;
const CardHeader = ({ className = "", children }: any) => <div className={cx("p-4 border-b border-white/10", className)}>{children}</div>;
const CardTitle = ({ className = "", children }: any) => <div className={cx("text-lg font-semibold", className)}>{children}</div>;
const CardDescription = ({ className = "", children }: any) => <div className={cx("text-sm text-white/60", className)}>{children}</div>;
const CardContent = ({ className = "", children }: any) => <div className={cx("p-4", className)}>{children}</div>;
const CardFooter = ({ className = "", children }: any) => <div className={cx("p-4 border-t border-white/10", className)}>{children}</div>;
const Input = React.forwardRef<HTMLInputElement, any>(({ className = "", ...props }, ref) =>
  <input ref={ref} className={cx("h-10 w-full px-3 rounded-md bg-white/5 border border-white/10 text-sm", className)} {...props} />);
Input.displayName = "Input";
  const Textarea = ({ className = "", ...props }: any) =>
  <textarea className={cx("w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm", className)} {...props} />;
const Badge = ({ className = "", children }: any) => <span className={cx("inline-flex items-center rounded-md px-2 py-1 text-xs border border-white/10 bg-white/10", className)}>{children}</span>;
const Switch = ({ checked, onCheckedChange }: any) => (
  <button type="button" onClick={() => onCheckedChange && onCheckedChange(!checked)} className={cx("w-10 h-6 rounded-full relative border border-white/10", checked ? "bg-emerald-500/60" : "bg-white/10")}> 
    <span className={cx("absolute top-0.5 transition-all h-5 w-5 rounded-full bg-white", checked ? "left-4" : "left-0.5")} />
  </button>
);

// --- Tiny hash router helper ---
function useHashRoute(defaultRoute: string = "/") {
  const [route, setRoute] = useState<string>(() => (typeof window !== 'undefined' ? (window.location.hash.replace('#','') || defaultRoute) : defaultRoute));
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace('#','') || defaultRoute);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [defaultRoute]);
  const push = (path: string) => {
    if (typeof window !== 'undefined') {
      window.location.hash = path.startsWith('#') ? path : `#${path}`;
    }
  };
  return { route, push } as const;
}

function getHashQueryParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  const hash = window.location.hash || "";
  const q = hash.split("?")[1] || "";
  return new URLSearchParams(q);
}

function pushExplore(
  push: (p: string) => void,
  params: Record<string, string | null | undefined>
) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") sp.set(k, String(v));
  });
  const qs = sp.toString();
  push(qs ? `/explore?${qs}` : "/explore");
  // Scroll to top when navigating to Explore
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}


type Agent = {
  id: string;
  name: string;
  priceUSDC: number;
  tagline: string;
  avatar: string;
  categories: string[];
  likes: number;
  sessions: number;
  promptPreview: string;
  description?: string; // full description shown on agent page
  createdAt: number; // timestamp (Date.now())
lastActiveAt?: number;      // последнее взаимодействие (chat/open/like)
sessions24h?: number;       // демо-счётчик
likes24h?: number;          // демо-счётчик


  // creator / payments
  creator?: string;
  creatorWallet?: string;

  // engine / RAG
  engineProvider?: "platform" | "creator_backend" | "tts";
  engineApiUrl?: string | null;
  ragEndpointUrl?: string | null;
  ragDescription?: string | null;
  toolsDescription?: string | null;

  // 🔐 Auth token for creator backend
  authToken?: string | null;

  // session limits
  maxMessagesPerSession?: number | null;
  maxDurationMinutes?: number | null;
};

type RuntimeMode = "hosted" | "custom" | "local";

type ExploreTab = "all" | "trending" | "top" | "new" | "category";

const CATEGORY_ITEMS = [
  { id: "tools", label: "Tools" },
  { id: "voice", label: "Voice" },
  { id: "design", label: "Design" },
  { id: "startup", label: "Startup" },
  { id: "builders", label: "Builders" },
  { id: "crypto", label: "Crypto" },
  { id: "finance", label: "Finance" },
  { id: "research", label: "Research" },
  { id: "marketing", label: "Marketing" },
  { id: "product", label: "Product" },
  { id: "devrel", label: "DevRel" },
  { id: "trading", label: "Trading" },
  { id: "security", label: "Security" },
];


// --- Paid sessions (local, per-agent) ---
type AgentSession = {
  paidAt: number;
  expiresAt: number | null; // null = без ограничения по времени
  tx?: string;              // id транзакции (опционально)
};

// --- Reviews per agent (stored locally) ---
type AgentReview = {
  id: string;
  rating: number;       // 1-5
  text: string;
  user?: string;        // optional display name
  createdAt: number;    // timestamp
};

const SESSION_KEY_PREFIX = "echo_session_";

function getSessionKey(agentId: string) {
  return `${SESSION_KEY_PREFIX}${agentId}`;
}

// получить активную сессию по агенту (учитываем истечение по времени)
function getActiveSession(agentId: string): AgentSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getSessionKey(agentId));
    if (!raw) return null;
    const data = JSON.parse(raw) as AgentSession;

    if (data.expiresAt && Date.now() > data.expiresAt) {
      // если время вышло — чистим и возвращаем null
      window.localStorage.removeItem(getSessionKey(agentId));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

// сохранить новую сессию после оплаты
function saveSession(agent: Agent, tx?: string) {
  if (typeof window === "undefined") return;
  const now = Date.now();

  let expiresAt: number | null = null;
  if (agent.maxDurationMinutes && agent.maxDurationMinutes > 0) {
    expiresAt = now + agent.maxDurationMinutes * 60 * 1000;
  }

  const session: AgentSession = { paidAt: now, expiresAt, tx };

  try {
    window.localStorage.setItem(getSessionKey(agent.id), JSON.stringify(session));
  } catch {
    // игнорим ошибки localStorage
  }
}

// очистить сессию (когда покупаем новую)
function clearSession(agentId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getSessionKey(agentId));
  } catch {}
}

// получить все активные сессии для списка агентов
function getAllActiveSessions(agents: Agent[]): Array<{ agent: Agent; session: AgentSession }> {
  if (typeof window === "undefined") return [];
  
  const activeSessions: Array<{ agent: Agent; session: AgentSession }> = [];
  
  for (const agent of agents) {
    const session = getActiveSession(agent.id);
    if (session) {
      activeSessions.push({ agent, session });
    }
  }
  
  return activeSessions;
}

// ✅ Verify payment transaction on-chain (replaces broken external server)
async function verifyPaymentOnChain(
  signature: string,
  expectedRecipient: string,
  expectedAmount: number,
  buyerPubkey: string
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const connection = await getSolanaConnection();
    const DECIMALS = 6;
    const expectedRawAmount = Math.round(expectedAmount * 10 ** DECIMALS);

    // Get transaction details
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { valid: false, reason: "Transaction not found on blockchain" };
    }

    if (!tx.meta) {
      return { valid: false, reason: "Transaction metadata not available" };
    }

    if (tx.meta.err) {
      return { valid: false, reason: `Transaction failed: ${JSON.stringify(tx.meta.err)}` };
    }

    // Check if transaction was successful
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];

    // Find USDC token transfer
    const recipientPubkey = new PublicKey(expectedRecipient);
    const recipientATA = await getAssociatedTokenAddress(
      new PublicKey(USDC_MINT),
      recipientPubkey
    );

    let foundTransfer = false;
    let transferredAmount = 0;

    // Check token balance changes
    for (const post of postBalances) {
      if (post.owner === recipientATA.toString() && post.mint === USDC_MINT) {
        const pre = preBalances.find(
          (p) => p.accountIndex === post.accountIndex && p.mint === USDC_MINT
        );
        const preAmount = pre ? parseFloat(pre.uiTokenAmount.uiAmountString || "0") : 0;
        const postAmount = parseFloat(post.uiTokenAmount.uiAmountString || "0");
        const diff = postAmount - preAmount;

        if (diff > 0) {
          foundTransfer = true;
          transferredAmount = Math.round(diff * 10 ** DECIMALS);
          break;
        }
      }
    }

    if (!foundTransfer) {
      return { valid: false, reason: "No USDC transfer found to recipient" };
    }

    // Verify amount (allow small rounding differences)
    const amountDiff = Math.abs(transferredAmount - expectedRawAmount);
    if (amountDiff > 100) { // Allow 0.0001 USDC difference for rounding
      return {
        valid: false,
        reason: `Amount mismatch: expected ${expectedAmount} USDC, got ${transferredAmount / 10 ** DECIMALS}`,
      };
    }

    return { valid: true };
  } catch (e: any) {
    console.error("Payment verification error:", e);
    return { valid: false, reason: e?.message || "Verification failed" };
  }
}




const INITIAL_AGENTS: Agent[] = [
  // 🔊 Text-to-Speech Agent (ElevenLabs)
  {
    id: "tts-agent",
    name: "Voice Generator",
    priceUSDC: 0,
    tagline: "Convert any text to natural speech instantly.",
    avatar: "🔊",
    categories: ["tools", "voice"],
    likes: 2840,
    sessions: 5120,
    promptPreview: "I convert your text into natural-sounding speech using advanced AI voices.",
    description: "Voice Generator is a powerful text-to-speech tool powered by ElevenLabs. Simply type or paste any text, and I'll convert it to natural, human-like speech. Perfect for:\n\n• Creating voiceovers for videos\n• Listening to articles and documents\n• Accessibility and learning\n• Content creation\n\nSupports multiple languages and voices. Just send me your text and I'll speak it back to you!",
    engineProvider: "tts",
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    lastActiveAt: Date.now() - 1000 * 60 * 30,
    sessions24h: 156,
    likes24h: 42,
  },
  {
    id: "a1",
    name: "AI Startup Mentor",
    priceUSDC: 0.30,
    tagline: "Pitch, tokenomics & GTM in minutes.",
    avatar: "🚀",
    categories: ["startup", "strategy"],
    likes: 1560,
    sessions: 1842,
    promptPreview: "You are a pragmatic startup advisor...",
    engineProvider: "platform",
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // вчера
lastActiveAt: Date.now() - 1000 * 60 * 60 * 2,    // 2 часа назад
sessions24h: 12,
likes24h: 5,

  },
  {
    id: "a2",
    name: "Crypto Analyst",
    priceUSDC: 0.25,
    tagline: "On-chain metrics & narratives.",
    avatar: "📈",
    categories: ["crypto", "finance"],
    likes: 1825,
    sessions: 2205,
    promptPreview: "Analyze token flows, performance, catalysts...",
    engineProvider: "platform",
    createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
lastActiveAt: Date.now() - 1000 * 60 * 60 * 2,    // 2 часа назад
sessions24h: 15,
likes24h: 5,

  },
  {
    id: "a3",
    name: "AI Designer Mentor",
    priceUSDC: 0.20,
    tagline: "Brand, layout, and critique.",
    avatar: "🎨",
    categories: ["design", "brand"],
    likes: 940,
    sessions: 1610,
    promptPreview: "You are a senior design reviewer...",
    engineProvider: "platform",
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
lastActiveAt: Date.now() - 1000 * 60 * 60 * 2,    // 2 часа назад
sessions24h: 12,
likes24h: 5,

  },
  {
    id: "a4",
    name: "Virtual Companion",
    priceUSDC: 0.15,
    tagline: "Talk, reflect, decompress.",
    avatar: "✨",
    categories: ["companion"],
    likes: 2110,
    sessions: 3401,
    promptPreview: "Supportive, empathetic companion persona...",
    engineProvider: "platform",
    createdAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
lastActiveAt: Date.now() - 1000 * 60 * 60 * 2,    // 2 часа назад
sessions24h: 12,
likes24h: 5,

  },
];

const homeCollections = [
  {
    id: "cozy-crypto",
    title: "Top crypto research agents",
    subtitle: "Narratives, perps, on-chain data & funding",
    emoji: "📊",
    accent: "from-cyan-500/60 via-sky-500/40 to-indigo-500/60",
    query: "crypto",
  },
  {
    id: "design-lab",
    title: "Design & branding lab",
    subtitle: "UX audit, landing pages, brand systems",
    emoji: "🎨",
    accent: "from-fuchsia-500/60 via-pink-500/40 to-purple-500/60",
    query: "design",
  },
  {
    id: "founder-stack",
    title: "Founder playbook",
    subtitle: "Pitch, GTM, tokenomics & fundraising",
    emoji: "🚀",
    accent: "from-emerald-500/60 via-teal-500/40 to-cyan-500/60",
    query: "founder",
  },
  {
    id: "companion",
    title: "Safe companion agents",
    subtitle: "Talk, reflect and decompress",
    emoji: "💬",
    accent: "from-amber-500/60 via-orange-500/40 to-rose-500/60",
    query: "companion",
  },
  {
    id: "builders",
    title: "For on-chain builders",
    subtitle: "Docs copilots, code reviewers, devrel",
    emoji: "👨‍💻",
    accent: "from-indigo-500/60 via-blue-500/40 to-cyan-500/60",
    query: "builder",
  },
];
const EXTRA_TOP_TAGS = [
  { id: "all", label: "All" },
  { id: "trending", label: "Trending" },
  { id: "top", label: "Top rated" },
  { id: "new", label: "New" },
  { id: "crypto", label: "Crypto" },
  { id: "design", label: "Design" },
  { id: "startup", label: "Startup" },
  { id: "builders", label: "Builders" },
];


function buildTopTags() {
  const fromCollections = homeCollections.map((c) => ({
    id: c.id,
    label: c.title,
    emoji: c.emoji,
  }));

  return [EXTRA_TOP_TAGS[0], ...fromCollections, ...EXTRA_TOP_TAGS.slice(1)];
}



const formatUSDC = (n: number) => `${n.toFixed(2)} USDC`;

export default function Echo() {
  // Routing (no Next.js)
  const { route, push } = useHashRoute("/");
  const topTags = useMemo(() => buildTopTags(), []);

  useEffect(() => {
    if (route === "/") {
      restoreHomeScrollOnce();
    }
  }, [route]);
  
  

  // App state
const [connected, setConnected] = useState(false);
const [address, setAddress] = useState<string | null>(null);      // короткий для UI
const [walletPk, setWalletPk] = useState<string | null>(null);    // полный pubkey
// 💰 USDC balance state
const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
const [usdcLoading, setUsdcLoading] = useState(false);
// 💰 SOL balance (native)
const [solBalance, setSolBalance] = useState<number | null>(null);
const [activeView, setActiveView] = useState<"home" | "learn">("home");


  // Подписки на события Phantom + тихая автоподключалка
  useEffect(() => {
    const provider = getPhantomProvider();
    if (!provider) return;
  
    const onConnect = (publicKey?: any) => {
      const key = (publicKey?.toString?.()) || provider.publicKey?.toString?.() || "";
      setConnected(true);
      setWalletPk(key);              // полный pubkey
      setAddress(shorten(key));      // короткий для UI
    };
    const onDisconnect = () => {
      setConnected(false);
      setAddress(null);
      setWalletPk(null);
    };
    const onAccountChanged = (publicKey?: any) => {
      if (publicKey) onConnect(publicKey); else onDisconnect();
    };
  
    provider.on?.("connect", onConnect);
    provider.on?.("disconnect", onDisconnect);
    provider.on?.("accountChanged", onAccountChanged);
  
    provider.connect?.({ onlyIfTrusted: true }).catch(() => {});
  
    return () => {
      provider.removeListener?.("connect", onConnect);
      provider.removeListener?.("disconnect", onDisconnect);
      provider.removeListener?.("accountChanged", onAccountChanged);
    };
  }, []);
  
   // --- Load USDC & SOL balance whenever wallet changes ---
useEffect(() => {
  if (!walletPk) {
    setUsdcBalance(null);
    setSolBalance(null);
    return;
  }

  let cancelled = false;

  async function loadBalances() {
    try {
      setUsdcLoading(true);

      const connection = await getSolanaConnection();
      if (!walletPk) return;
      const owner = new PublicKey(walletPk);
      const mint = new PublicKey(USDC_MINT);

      // --- USDC ---
      try {
        const ata = await getAssociatedTokenAddress(mint, owner);
        const accountInfo = await connection.getTokenAccountBalance(ata);
        const uiAmount = accountInfo.value.uiAmount ?? 0;
        if (!cancelled) setUsdcBalance(uiAmount);
      } catch (e: any) {
        // Token account doesn't exist = 0 balance (not an error)
        if (e?.message?.includes("could not find account") || e?.message?.includes("Invalid param")) {
          if (!cancelled) setUsdcBalance(0);
        } else {
          console.error("Failed to load USDC balance:", e);
          // Keep previous balance on error instead of resetting to 0
        }
      }

      // --- SOL ---
      try {
        const lamports = await connection.getBalance(owner);
        const sol = lamports / LAMPORTS_PER_SOL;
        if (!cancelled) setSolBalance(sol);
      } catch (e: any) {
        console.error("Failed to load SOL balance:", e);
        // Keep previous balance on error
      }
    } catch (e: any) {
      console.error("Balance loading error:", e);
      // Don't reset balances on error - keep previous values
    } finally {
      if (!cancelled) setUsdcLoading(false);
    }
  }

  loadBalances();

  return () => {
    cancelled = true;
  };
}, [walletPk]);


  

    const [agents, setAgents] = useState<Agent[]>(() => {
    const storedAgents = loadLS<Agent[]>(LS.AGENTS, []);
    
    // Merge: ensure all INITIAL_AGENTS exist (add missing built-in agents)
    const storedIds = new Set(storedAgents.map(a => a.id));
    const missingBuiltIn = INITIAL_AGENTS.filter(a => !storedIds.has(a.id));
    
    if (missingBuiltIn.length > 0) {
      // Add missing built-in agents at the beginning
      return [...missingBuiltIn, ...storedAgents];
    }
    
    return storedAgents.length > 0 ? storedAgents : INITIAL_AGENTS;
  });  
  const [query, setQuery] = useState("");
  type SortBy =
  | "recommended"
  | "newest"
  | "likes_desc"
  | "sessions_desc"
  | "price_low"
  | "price_high"
  | "name_az"
  | "trending"; // ✅


  const [sortBy, setSortBy] = useState<SortBy>('recommended');
  const [exploreTab, setExploreTab] = useState<ExploreTab>("all");
  const [selected, setSelected] = useState<Agent | null>(null);
  // Dedicated flag to control Pay modal visibility - only true when user explicitly opens it
  const [payModalOpen, setPayModalOpen] = useState(false);
  // Modal state machine - controls banners and payment flow
  const [modalState, setModalState] = useState<"idle" | "ready" | "processing" | "paid" | "error" | "missing_payout_wallet" | "free" | "creator_free">("idle");

  // ✅ Reset trending counters every 24 hours (moved here after agents state)
  useEffect(() => {
    if (typeof window === "undefined") return;
  
    const now = Date.now();
    const last = Number(localStorage.getItem(TRENDING_RESET_KEY) || 0);
  
    // каждые 24 часа обнуляем "24h" счётчики
    if (!last || now - last > 24 * 60 * 60 * 1000) {
      setAgents(prev =>
        prev.map(a => ({
          ...a,
          sessions24h: 0,
          likes24h: 0,
        }))
      );
      localStorage.setItem(TRENDING_RESET_KEY, String(now));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
  
    const savedAgentId = localStorage.getItem("selectedAgentId");
  
    if (savedAgentId) {
      const agent = agents.find(a => a.id === savedAgentId);
      if (agent) {
        setSelected(agent);
      }
    }
    // Removed paidSession localStorage check - use active session instead
    // NOTE: We restore selectedAgent for convenience but DO NOT auto-open modal
    // Modal only opens when user explicitly clicks Chat/Pay button
  }, [agents]);

  // Reset modal state when selected agent changes
  useEffect(() => {
    setModalState("idle");
  }, [selected?.id]);
  
  // достаточно ли USDC для оплаты выбранного агента
  const notEnoughUsdc =
    selected && usdcBalance !== null
      ? usdcBalance < selected.priceUSDC
      : false;

  // create / edit agent modal
  const [creating, setCreating] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [shouldScrollToForm, setShouldScrollToForm] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [newAgent, setNewAgent] = useState<Agent>({
    id: "",
    name: "",
    priceUSDC: 0.2,
    tagline: "",
    avatar: "🤖",
    categories: [],
    likes: 0,
    sessions: 0,
    promptPreview: "",
    createdAt: Date.now(),          // ✅ добавь
    engineProvider: "platform",
    engineApiUrl: "",
    ragEndpointUrl: "",
    ragDescription: "",
    toolsDescription: "",
    authToken: null,
    maxMessagesPerSession: null,
    maxDurationMinutes: null,
  });
  
  const [autoPrice, setAutoPrice] = useState(true);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("hosted");
  
  const [endpointTestStatus, setEndpointTestStatus] = useState<
  "idle" | "testing" | "ok" | "fail"
>("idle");
const [endpointTestMsg, setEndpointTestMsg] = useState<string>("");

// Scroll to edit form and focus name input when triggered from Profile
useEffect(() => {
  if (creating && shouldScrollToForm) {
    // Reset the flag
    setShouldScrollToForm(false);
    
    // Scroll to top and focus name input after DOM updates
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      
      // Focus name input after scroll animation
      setTimeout(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }, 100);
    });
  }
}, [creating, shouldScrollToForm]);

function isValidHttpUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function testChatEndpoint() {
  const url = (newAgent.engineApiUrl || "").trim();

  if (!url) {
    setEndpointTestStatus("fail");
    setEndpointTestMsg("Please enter a Chat endpoint URL first.");
    return;
  }
  if (!isValidHttpUrl(url)) {
    setEndpointTestStatus("fail");
    setEndpointTestMsg("Endpoint must be a valid http(s) URL.");
    return;
  }

  setEndpointTestStatus("testing");
  setEndpointTestMsg("");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(newAgent.authToken
          ? { "x-echo-key": String(newAgent.authToken) }
          : {}),
      },
      body: JSON.stringify({
        type: "ping",
        message: "Hello from Echo (test). Reply with any text.",
        // можешь добавить что ожидает твой бэк:
        // agentId: editingAgentId ?? "test-agent",
      }),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      setEndpointTestStatus("fail");
      setEndpointTestMsg(
        `HTTP ${res.status}. ${text ? text.slice(0, 140) : "No response body."}`
      );
      return;
    }

    setEndpointTestStatus("ok");
    setEndpointTestMsg("OK — endpoint responded successfully.");
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "Timeout (9s). Endpoint did not respond."
        : e?.message || "Request failed.";

    // ВАЖНО: если у тебя CORS — браузер часто покажет ошибку здесь.
    setEndpointTestStatus("fail");
    setEndpointTestMsg(msg);
  } finally {
    clearTimeout(t);
  }
}



  // per-user like memory (one-like-per-agent)
  const [liked, setLiked] = useState<Record<string, boolean>>(() =>
  loadLS<Record<string, boolean>>(LS.LIKED, {})
);
  
  // per-user saved/favorites (Saved agents)
  const [saved, setSaved] = useState<Record<string, boolean>>(() =>
  loadLS<Record<string, boolean>>(LS.SAVED, {})
);
 

  function toggleSaved(id: string) {
    setSaved((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  useEffect(() => {
    if (!route.startsWith("/explore")) return;
  
    const sp = getHashQueryParams();
  
    const tab = (sp.get("tab") as ExploreTab) || "all";
    const q = sp.get("q") || "";
    const sort = (sp.get("sort") as SortBy) || "recommended";
  
    setExploreTab(tab);
    setQuery(q);
    setSortBy(sort);
  }, [route]);
  
  // Purchases (for Profile > Purchases)
  type Purchase = { id: string; agentId: string; priceUSDC: number; ts: number };
  const [purchases, setPurchases] = useState<
  { id: string; agentId: string; priceUSDC: number; ts: number }[]
>(() => loadLS(LS.PURCHASES, []));
    // --- Reviews per agent (local storage) ---
    const [reviews, setReviews] = useState<Record<string, AgentReview[]>>(() =>
    loadLS<Record<string, AgentReview[]>>(LS.REVIEWS, {})
  );
  
// ===================== PERSISTENCE (SAVE TO LOCALSTORAGE) =====================
useEffect(() => { saveLS(LS.AGENTS, agents); }, [agents]);

useEffect(() => { saveLS(LS.LIKED, liked); }, [liked]);

useEffect(() => { saveLS(LS.SAVED, saved); }, [saved]);

useEffect(() => { saveLS(LS.PURCHASES, purchases); }, [purchases]);

useEffect(() => { saveLS(LS.REVIEWS, reviews); }, [reviews]);

  
  
    // обработчик добавления отзыва
    function handleAddReview(
      agentId: string,
      data: { rating: number; text: string; user?: string }
    ) {
      setReviews((prev) => {
        const list = prev[agentId] || [];
        let id: string;
        try {
          id = crypto.randomUUID();
        } catch {
          id = `${Date.now()}_${Math.random()}`;
        }
  
        const next: AgentReview = {
          id,
          rating: data.rating,
          text: data.text,
          user: data.user?.trim() || "Anonymous",
          createdAt: Date.now(),
        };
  
        return {
          ...prev,
          [agentId]: [...list, next],
        };
      });
    }
  

  // --- NEW: skeleton loading state ---
  const [loadingGrid, setLoadingGrid] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoadingGrid(false), 700); // loading skeleton
    return () => clearTimeout(t);
  }, []);

  // Compute Top Rated set (by likes, then sessions)
  const topRatedIds = useMemo(() => {
    const sorted = [...agents].sort((a,b)=> (b.likes - a.likes) || (b.sessions - a.sessions));
    return new Set(sorted.slice(0,3).map(a=>a.id));
  }, [agents]);
 
  const hashParams = useMemo(() => getHashQueryParams(), [route]);
  const exploreCategory = hashParams.get("q") || "";
  const exploreTabFromUrl = (hashParams.get("tab") as ExploreTab) || "all";  
  const filtered = useMemo(() => {
    return agents.filter(a => {
      const q = query.trim().toLowerCase();
  
      // 1) если tab=category → фильтруем строго по categories
      if (exploreTabFromUrl === "category" && exploreCategory) {
        return a.categories.map(x => x.toLowerCase()).includes(exploreCategory.toLowerCase());
      }
  
      // 2) иначе обычный поиск
      const hay = `${a.name} ${a.tagline} ${a.categories.join(" ")}`.toLowerCase();
      return !q || hay.includes(q);
    });
  }, [agents, query, exploreTabFromUrl, exploreCategory]);
  
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case 'newest':
        return arr.sort((a, b) => (b.createdAt - a.createdAt));
      case 'likes_desc':
        return arr.sort((a,b) => (b.likes - a.likes));
      case 'sessions_desc':
        return arr.sort((a,b) => (b.sessions - a.sessions));
      case 'price_low':
        return arr.sort((a,b) => (a.priceUSDC - b.priceUSDC));
      case 'price_high':
        return arr.sort((a,b) => (b.priceUSDC - a.priceUSDC));
      case 'name_az':
        return arr.sort((a,b) => a.name.localeCompare(b.name));
      case 'recommended':
      default:
        return arr;
        case "trending": {
          const now = Date.now();
        
          const score = (a: Agent) => {
            const s24 = a.sessions24h ?? 0;
            const l24 = a.likes24h ?? 0;
            const last = a.lastActiveAt ?? a.createdAt ?? 0;
            const hoursAgo = (now - last) / (1000 * 60 * 60);
            const decay = 1 / (1 + hoursAgo / 24);
            return (s24 * 3 + l24) * decay;
          };
        
          return arr.sort(
            (a, b) =>
              score(b) - score(a) ||
              (b.createdAt ?? 0) - (a.createdAt ?? 0)
          );
        }        
    }
  }, [filtered, sortBy]);
  
    

  // Keep Top Rated always pinned at the top of any filtered list
  const trendingAgents = useMemo(() => {
    const now = Date.now();
  
    const score = (a: Agent) => {
      const s24 = a.sessions24h ?? 0;
      const l24 = a.likes24h ?? 0;
  
      const last = a.lastActiveAt ?? a.createdAt ?? 0;
      const hoursAgo = (now - last) / (1000 * 60 * 60);
  
      // затухание: чем старее активность — тем меньше вес
      const decay = 1 / (1 + hoursAgo / 24);
  
      // сессии важнее лайков
      const base = s24 * 3 + l24 * 1;
  
      return base * decay;
    };
  
    return [...agents]
      .sort((a, b) => score(b) - score(a) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 10);
  }, [agents]);
  
  
  const topRatedAgents = useMemo(() => {
    return [...agents]
      .sort((a, b) =>
        (b.likes - a.likes) ||
        (b.sessions - a.sessions)
      )
      .slice(0, 10);
  }, [agents]);
  
  
  const newAgents = useMemo(() => {
    return [...agents]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 10);
  }, [agents]);
  
  
  // Wallet (real Phantom)
  function handleStartCreate() {
    // если кошелёк не подключен — не даём открыть модалку
    if (!connected || !walletPk) {
      alert(
        "Connect your Phantom wallet before creating an agent. " +
        "We need your wallet to route USDC payments from sessions."
      );
      handleConnect(); // попробуем сразу открыть Phantom
      return;
    }
    // если кошелёк есть — всё как раньше
    startCreate();
  }

  function handleConnect() { connectPhantom(setConnected, setAddress, setWalletPk); }
  function handleDisconnect() { disconnectPhantom(setConnected, setAddress, setWalletPk); }
  

  // Start chat → route to #/chat with selected agent id and increment sessions
  function startChat() {
    if (!selected) return;

    // +1 к количеству сессий у этого агента (статистика)
    const now = Date.now();
    setAgents(prev =>
      prev.map(a =>
        a.id === selected.id
          ? {
              ...a,
              sessions: a.sessions + 1,
              sessions24h: (a.sessions24h ?? 0) + 1,
              lastActiveAt: now,
            }
          : a
      )
    );
    
    // Close modal and clear state before navigation
    setPayModalOpen(false);
    setModalState("idle");
    
    // Clear localStorage flags before navigation
    if (typeof window !== "undefined") {
      localStorage.removeItem("paidSession");
      localStorage.removeItem("selectedAgentId");
    }
    
    const agentId = selected.id;
    setSelected(null);

    // уходим на чат с этим агентом
    push(`/chat?id=${encodeURIComponent(agentId)}`);
  }
  
  function openAgentView(agentId: string) {
    rememberHomeScroll();
    push(`/agent?id=${encodeURIComponent(agentId)}`);
  }

  function openPay(agent: Agent) {
    // 1) Creator → free, go directly to chat (no modal needed)
    if (connected && agent.creator && address === agent.creator) {
      setPurchases((prev) => [
        {
          id: crypto.randomUUID(),
          agentId: agent.id,
          priceUSDC: agent.priceUSDC,
          ts: Date.now(),
        },
        ...prev,
      ]);
      
      setSelected(agent);
      // Clear localStorage flags before navigation
      if (typeof window !== "undefined") {
        localStorage.removeItem("paidSession");
        localStorage.removeItem("selectedAgentId");
      }
      setPayModalOpen(false);
      push(`/chat?id=${encodeURIComponent(agent.id)}`);
      return;
    }
  
    // 2) If active session exists → go directly to chat (resume), skip modal
    const activeSession =
      typeof window !== "undefined" ? getActiveSession(agent.id) : null;

    if (activeSession) {
      setSelected(agent);
      // Clear localStorage flags before navigation
      if (typeof window !== "undefined") {
        localStorage.removeItem("paidSession");
        localStorage.removeItem("selectedAgentId");
      }
      setPayModalOpen(false);
      push(`/chat?id=${encodeURIComponent(agent.id)}`);
      return;
    }
    
    // 3) Otherwise → open payment modal on home page with initial state
    // This is the ONLY place where we set payModalOpen = true
    setSelected(agent);
    setPayModalOpen(true);
    
    // Determine initial modal state based on current agent properties
    const isFreeAgent = !agent.creator && !agent.creatorWallet;
    if (isFreeAgent) {
      setModalState("free");
    } else if (!agent.creatorWallet) {
      // Agent is payable but has no payout wallet configured
      setModalState("missing_payout_wallet");
    } else {
      // Agent is ready to accept payment
      setModalState("ready");
    }
    
    push("/");
  }    
    
  function closePay() {
    setPayModalOpen(false);
    setSelected(null);
    setModalState("idle");
    // Clear localStorage flags when closing modal
    if (typeof window !== "undefined") {
      localStorage.removeItem("paidSession");
      localStorage.removeItem("selectedAgentId");
    }
  }

  // like handler with guard (toggle like/unlike, one like per agent per user)
  function handleLike(id: string) {
    setLiked((prev) => {
      const next = !prev[id];
  
      setAgents((ags) =>
        ags.map((a) =>
          a.id === id ? { ...a, likes: Math.max(0, (a.likes || 0) + (next ? 1 : -1)) } : a
        )
      );
  
      return { ...prev, [id]: next };
    });
  }
  
  function startCreate() {
    // режим "создания" — сбрасываем форму
    setEditingAgentId(null);
    setNewAgent({
      id: "",
      name: "",
      priceUSDC: 0.2,
      tagline: "",
description: "",
avatar: "🤖",
      categories: [],
      likes: 0,
      sessions: 0,
      promptPreview: "",
      createdAt: Date.now(),
      engineProvider: "platform",
      engineApiUrl: "",
      ragEndpointUrl: "",
      ragDescription: "",
      toolsDescription: "",
      authToken: null,             // 🔐 добавили
      maxMessagesPerSession: null,
      maxDurationMinutes: null,
    });     
    setAutoPrice(true);
setCreating(true);

  }

  function startEdit(agent: Agent) {
    // режим "редактирования" — подставляем данные агента в форму
    setEditingAgentId(agent.id);
    setNewAgent({ ...agent });
    setAutoPrice(false); // при редактировании обычно руками правим цену  
    setCreating(true);
    setShouldScrollToForm(true); // trigger scroll after form renders
  }

  function cancelCreate() {
    setCreating(false);
    setEditingAgentId(null);
    setShouldScrollToForm(false);
    setNewAgent({
      id: "",
      name: "",
      priceUSDC: 0.2,
      tagline: "",
description: "",
avatar: "🤖",
      categories: [],
      likes: 0,
      sessions: 0,
      promptPreview: "",
      createdAt: Date.now(),
      engineProvider: "platform",
      engineApiUrl: "",
      ragEndpointUrl: "",
      ragDescription: "",
      toolsDescription: "",
      authToken: null,             // 🔐 добавили
      maxMessagesPerSession: null,
      maxDurationMinutes: null,
    });     
    setAutoPrice(true);
  }

  function submitCreate() {
    const categories = deriveCategories(newAgent);
    const priceUSDC = autoPrice
      ? autoPriceFromPrompt(newAgent.promptPreview)
      : newAgent.priceUSDC;

    // 🔹 РЕЖИМ РЕДАКТИРОВАНИЯ
    if (editingAgentId) {
      setAgents(prev =>
        prev.map(a => {
          if (a.id !== editingAgentId) return a;
          return {
            ...a,
            ...newAgent,
            id: a.id, // id не меняем
            categories,
            priceUSDC,
            creator: a.creator, // не трогаем создателя
            creatorWallet: a.creatorWallet,
          };
        })
      );
      setCreating(false);
      setEditingAgentId(null);
      return;
    }

    // 🔹 РЕЖИМ СОЗДАНИЯ НОВОГО
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now());

        const agent: Agent = {
          ...newAgent,
          id,
          categories,
          priceUSDC,
          sessions: 0,
          createdAt: Date.now(), // ✅ NEW
          creator: address || "local",
          creatorWallet: walletPk || undefined,
        };
        

    setAgents(prev => [agent, ...prev]);
    setSelected(agent);
    setModalState("idle"); // Reset modal state
    setCreating(false);
    push(`/chat?id=${encodeURIComponent(agent.id)}`);
  }


  function deriveCategories(a: Agent): string[] {
    const base: string[] = [];
    const p = `${a.name} ${a.tagline} ${a.promptPreview}`.toLowerCase();
    if (/(design|ux|ui|brand)/.test(p)) base.push("design");
    if (/(crypto|defi|token|on-chain|finance|trading)/.test(p)) base.push("crypto");
    if (/(mentor|startup|growth|gtm)/.test(p)) base.push("startup");
    if (/(therapy|companion|talk|friend)/.test(p)) base.push("companion");
    if (!base.length) base.push("general");
    return base;
  }
  function autoPriceFromPrompt(p: string): number { const len = p.length; const complexity = (/(analysis|strategy|tokenomics|pipeline|voice|image|vision|audio)/.test(p) ? 1 : 0) + (len > 220 ? 1 : 0); const base = 0.15; return Math.min(0.75, +(base + complexity * 0.1).toFixed(2)); }


    // --- Views ---
  // Profile routes
  if (route.startsWith("/profile/agents")) {
    return (
      <ProfileAgentsView
        onBack={() => push("/")}
        agents={agents}
        address={address}
        onOpenAgent={(id) =>
          push(`/agent?id=${encodeURIComponent(id)}`)
        }
        onEditAgent={(agent) => {
          // Start edit mode and navigate to home (where create/edit form is)
          startEdit(agent);
          push("/"); // Navigate away from profile to show the edit form
        }}
      />
    );
  }
  
  if (route.startsWith("/profile/saved")) {
    return (
      <ProfileSavedView
        onBack={() => push("/")}
        agents={agents}
        saved={saved}
        onOpenAgent={(id) =>
          push(`/agent?id=${encodeURIComponent(id)}`)
        }
        onOpenPay={(ag) => openPay(ag)}
      />
    );
  }


  if (route.startsWith('/profile/purchases')) {
    return <ProfilePurchasesView onBack={() => push('/')} agents={agents} purchases={purchases} />;
  }
  if (route.startsWith('/profile/stats')) {
    return <ProfileStatsView onBack={() => push('/')} agents={agents} address={address} purchases={purchases} />;
  }

  // 🔹 Learn page route
  if (route.startsWith("/learn")) {
    return <LearnPage onBack={() => push("/")} />;
  }

  // 🔹 About page route
  if (route.startsWith("/about")) {
    return <AboutPage onBack={() => push("/")} />;
  }

  // 🔹 Docs page route
  if (route.startsWith("/docs")) {
    return <DocsPage onBack={() => push("/")} />;
  }

  // 🔹 Privacy Policy page route
  if (route.startsWith("/privacy")) {
    return <PrivacyPage onBack={() => push("/")} />;
  }

    // 🔹 НОВЫЙ РОУТ: страница агента
    if (route.startsWith("/agent")) {
      const search = (typeof window !== "undefined")
        ? new URLSearchParams(window.location.hash.split("?")[1])
        : undefined;
      const id = search?.get("id") || "";
      const agent = agents.find((a) => a.id === id) || null;
  
      return (
        <AgentDetailView
          agent={agent}
          onBack={() => push("/")}
          onOpenPay={(ag) => openPay(ag)}
          liked={liked}
          onLike={handleLike}
          allAgents={agents}
          reviews={reviews}                    // 🔹 добавили
          onAddReview={handleAddReview}        // 🔹 добавили
        />
      );
    }
  
  

  if (route.startsWith("/chat")) {
    const search =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.hash.split("?")[1])
        : undefined;
    const id = search?.get("id") || selected?.id || INITIAL_AGENTS[0].id;
    const agent = agents.find((a) => a.id === id) || selected || null;
  
    const isCreator = !!agent && !!walletPk && agent.creatorWallet === walletPk;

  
    return (
      <ChatView
        onBack={() => push("/")}
        selectedAgent={agent}
        isCreator={isCreator}
      />
    );
  }
  

  // 🔹 Отдельная страница "Create / Edit Agent" вместо модалки
  if (creating) {
    const apiUrlTrimmed = (newAgent.engineApiUrl || "").trim();

const canPublish =
  // базовые поля (оставь минимум что тебе надо)
  !!newAgent.name?.trim() &&
  !!newAgent.tagline?.trim() &&
  !!newAgent.avatar?.trim() &&
  newAgent.priceUSDC >= 0.05 &&
  // если custom — обязателен endpoint
  (runtimeMode !== "custom" || (apiUrlTrimmed.length > 0 && isValidHttpUrl(apiUrlTrimmed)));

    return (
      
      <div className="min-h-screen w-screen overflow-x-hidden bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
        {/* Header для страницы создания */}
        <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                className="bg-white/10 hover:bg-white/20"
                onClick={cancelCreate} // вернёт на главную и сбросит состояние
              >
                ← Back
              </Button>
              <div className="font-semibold">
                {editingAgentId ? "Edit your Agent" : "Create your Agent"}
              </div>
            </div>
          </div>
        </header>

        {/* Контент страницы (сюда вставляем то, что было внутри модалки) */}
        <div className="max-w-3xl mx-auto px-4 py-6">
          <Card className="w-full bg-white/[.04] border-white/10 flex flex-col">
            {/* HEADER */}
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>
                  {editingAgentId ? "Edit your Agent" : "Create your Agent"}
                </CardTitle>
                <CardDescription className="text-white/60">
                  Publish a persona, set price, earn per session.
                </CardDescription>
              </div>
              <Button
                variant="secondary"
                className="text-white/80"
                onClick={cancelCreate}
              >
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>

            {/* ⬇️ ЭТО КОНТЕНТ, КОТОРЫЙ БЫЛ ВНУТРИ CardContent МОДАЛКИ */}
            <CardContent className="flex-1 overflow-y-auto px-4 space-y-6">
              {/* BASIC FIELDS */}
              <div className="space-y-3">
                <label className="text-sm text-white/70">Name</label>
                <Input
                  ref={nameInputRef}
                  value={newAgent.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewAgent(a => ({ ...a, name: e.target.value }))
                  }                  
                  className="bg-white/5 border-white/10"
                  placeholder="AI Crypto Analyst"
                />

                <label className="text-sm text-white/70">Tagline</label>
                <Input
                  value={newAgent.tagline}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewAgent(a => ({ ...a, tagline: e.target.value }))
                  }                  
                  className="bg-white/5 border-white/10"
                  placeholder="On-chain metrics &amp; narratives"
                />

{/* Description */}
<div className="space-y-2">
  <label className="text-sm text-white/70">Description</label>
  <Textarea
    value={newAgent.description || ""}
    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
      setNewAgent(a => ({ ...a, description: e.target.value }))
    }
    rows={5}
    placeholder="Explain what this agent does, who it's for, examples, limitations, etc."
    className="bg-white/5 border-white/10 text-sm"
  />
</div>
                <label className="text-sm text-white/70">
                  Avatar (emoji or URL)
                </label>
                <Input
                  value={newAgent.avatar}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewAgent(a => ({ ...a, avatar: e.target.value }))
                  }                  
                  className="bg-white/5 border-white/10"
                  placeholder="📈 or https://..."
                />
              </div>

              {/* PRICE / LIMITS */}
              <div className="space-y-3">
                <label className="text-sm text-white/70 flex items-center justify-between">
                  Price per session (USDC)
                  <span className="flex items-center gap-2 text-xs text-white/50">
                    <span>Auto-price</span>
                    <Switch
                      checked={autoPrice}
                      onCheckedChange={setAutoPrice}
                    />
                  </span>
                </label>

                <Input
                  type="number"
                  step="0.05"
                  min={0.05}
                  disabled={autoPrice}
                  value={newAgent.priceUSDC}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewAgent(a => ({
                      ...a,
                      priceUSDC: Number(e.target.value),
                    }))
                  }                  
                  className="bg-white/5 border-white/10"
                />

                <label className="text-sm text-white/70">
                  Max messages per session
                </label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 40"
                  value={newAgent.maxMessagesPerSession ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewAgent(a => ({
                      ...a,
                      maxMessagesPerSession:
                        e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  className="bg-white/5 border-white/10"
                />

                <label className="text-sm text-white/70">
                  Max duration (minutes)
                </label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 60"
                  value={newAgent.maxDurationMinutes ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewAgent(a => ({
                      ...a,
                      maxDurationMinutes:
                        e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  className="bg-white/5 border-white/10"
                />
              </div>

              {/* RUNTIME + режим-зависимые поля */}
              <div className="space-y-4 border-t border-white/10 pt-4">
                <div className="text-xs text-white/60">
                  Where does this agent actually run?
                </div>

                {/* 3 кнопки режимов */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {/* Hosted */}
                  <button
                    type="button"
                    onClick={() => {
                      setRuntimeMode("hosted");
                      setNewAgent(a => ({ ...a, engineProvider: "platform" }));
                    }}
                    className={cx(
                      "text-left rounded-lg border px-3 py-2 text-xs transition",
                      runtimeMode === "hosted"
                        ? "border-indigo-400 bg-indigo-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    )}
                  >
                    <div className="font-semibold text-white/90 text-[11px]">
                      Hosted on da GOAT
                    </div>
                    <div className="text-[10px] text-white/60">
                      We host and run this agent for you. No servers or URLs.
                    </div>
                  </button>


                  {/* Custom backend */}
                  <button
                    type="button"
                    onClick={() => {
                      setRuntimeMode("custom");
                      setNewAgent(a => ({
                        ...a,
                        engineProvider: "creator_backend",
                      }));
                    }}
                    className={cx(
                      "text-left rounded-lg border px-3 py-2 text-xs transition",
                      runtimeMode === "custom"
                        ? "border-indigo-400 bg-indigo-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    )}
                  >
                    <div className="font-semibold text-white/90 text-[11px]">
                      Use my backend
                    </div>
                    <div className="text-[10px] text-white/60">
                      We send messages to your API. You return the reply.
                    </div>
                  </button>

                  {/* Local */}
                  <button
                    type="button"
                    onClick={() => setRuntimeMode("local")}
                    className={cx(
                      "text-left rounded-lg border px-3 py-2 text-xs transition",
                      runtimeMode === "local"
                        ? "border-indigo-400 bg-indigo-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    )}
                  >
                    <div className="font-semibold text-white/90 text-[11px]">
                      Run on my computer
                    </div>
                    <div className="text-[10px] text-white/60">
                      Coming soon: local connector app.
                    </div>
                  </button>
                </div>

                {/* Hosted режим */}
                {runtimeMode === "hosted" && (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm text-white/70">
        System prompt / persona
      </label>

      <button
        type="button"
        onClick={() => (window.location.hash = "/learn?tab=hosted-prompt")}
        className="
          text-[11px] text-white/55 hover:text-white/85
          underline underline-offset-4
          transition
        "
      >
        Need help writing a great prompt? →
      </button>
    </div>

    <Textarea
  rows={4}
  value={newAgent.promptPreview}
  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setNewAgent(a => ({
      ...a,
      promptPreview: e.target.value,
    }))
  }
  className="bg-white/5 border-white/10"
/>
  </div>
)}

                {/* Custom backend */}
                {runtimeMode === "custom" && (
  <div className="space-y-4">
    {/* 1) Chat endpoint — главный и обязательный */}
    <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-white/80">
          Chat endpoint <span className="text-rose-300">*</span>
        </div>

        <button
          type="button"
          onClick={() => push("/learn#backend")}
          className="text-[11px] text-white/55 hover:text-white underline underline-offset-4 transition"
        >
          How to set it up →
        </button>
      </div>

      <p className="text-[11px] text-white/50">
        This is the ONLY required URL. We send messages here, your backend returns the reply.
      </p>

      <div className="flex gap-2 items-center">
  <Input
    placeholder="https://api.backend.com/run"
    value={newAgent.engineApiUrl || ""}
    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
      setNewAgent((a) => ({ ...a, engineApiUrl: e.target.value }));
      setEndpointTestStatus("idle");
      setEndpointTestMsg("");
    }}
    className="bg-white/5 border-white/10 text-xs flex-1"
  />

  <Button
    type="button"
    variant="secondary"
    className="bg-white/10 hover:bg-white/20 text-xs px-3"
    onClick={testChatEndpoint}
    disabled={endpointTestStatus === "testing"}
  >
    {endpointTestStatus === "testing" ? "Testing..." : "Test endpoint"}
  </Button>
</div>

{/* маленькая валидация прямо под полем */}
{runtimeMode === "custom" && !(newAgent.engineApiUrl || "").trim() && (
  <div className="text-[11px] text-amber-200">
    Chat endpoint is required in “Use my backend”.
  </div>
)}

{runtimeMode === "custom" &&
  (newAgent.engineApiUrl || "").trim() &&
  !isValidHttpUrl((newAgent.engineApiUrl || "").trim()) && (
    <div className="text-[11px] text-amber-200">
      Please enter a valid http(s) URL.
    </div>
  )}

{/* статус теста */}
{endpointTestStatus !== "idle" && endpointTestMsg && (
  <div
    className={
      endpointTestStatus === "ok"
        ? "text-[11px] text-emerald-300"
        : endpointTestStatus === "fail"
        ? "text-[11px] text-rose-300"
        : "text-[11px] text-white/60"
    }
  >
    {endpointTestMsg}
  </div>
)}


      <div className="text-[10px] text-white/45">
        Tip: return JSON like <span className="font-mono">{`{ "reply": "..." }`}</span>
      </div>
    </div>

    {/* 2) Auth token — опционально, но полезно */}
    <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
      <div className="text-xs font-semibold text-white/80">Auth token (optional)</div>
      <p className="text-[11px] text-white/50">
        We send it as <span className="font-mono">x-echo-key</span>. Use it to protect your backend.
      </p>

      <Input
        placeholder="my-secret-token"
        value={newAgent.authToken || ""}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
          setNewAgent((a) => ({
            ...a,
            authToken: e.target.value || null,
          }))
        }
        className="bg-white/5 border-white/10 text-xs"
      />

      <div className="text-[10px] text-amber-200 bg-amber-500/10 rounded px-2 py-1 border border-amber-400/40">
        Do NOT put OpenAI keys here. Keep model keys on your backend.
      </div>
    </div>

    {/* 3) Advanced — прячем RAG + Tools */}
    <details className="rounded-lg bg-white/5 border border-white/10 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-white/75 select-none">
        Advanced (optional)
        <span className="text-white/45 font-normal"> — RAG & tools</span>
      </summary>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* RAG */}
        <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
          <div className="text-xs font-semibold text-white/70">RAG / Knowledge Base</div>
          <p className="text-[11px] text-white/50">
            Optional URL for docs search / vector DB / knowledge.
          </p>

          <Input
            placeholder="https://your-backend.com/rag"
            value={newAgent.ragEndpointUrl || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
              setNewAgent((a) => ({
                ...a,
                ragEndpointUrl: e.target.value,
              }))
            }
            className="bg-white/5 border-white/10 text-xs"
          />

          <Textarea
            rows={2}
            placeholder="Describe what docs are connected (FAQ, docs, KB, etc.)"
            value={newAgent.ragDescription || ""}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setNewAgent((a) => ({
                ...a,
                ragDescription: e.target.value,
              }))
            }
            className="bg-white/5 border-white/10 text-xs"
          />
        </div>

        {/* Tools */}
        <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
          <div className="text-xs font-semibold text-white/70">Tools</div>
          <p className="text-[11px] text-white/50">
            List external integrations your backend can use (APIs, on-chain fetchers, etc.)
          </p>

          <Textarea
            rows={4}
            placeholder="e.g. on-chain fetcher, pricing API, CRM, analytics…"
            value={newAgent.toolsDescription || ""}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setNewAgent((a) => ({
                ...a,
                toolsDescription: e.target.value,
              }))
            }
            className="bg-white/5 border-white/10 text-xs"
          />
        </div>
      </div>
    </details>
  </div>
)}


                {/* Local mode */}
                {runtimeMode === "local" && (
                  <div className="space-y-2 text-xs text-white/60">
                    <div className="font-semibold text-white/70">
                      Local connector (coming soon)
                    </div>
                    <p>
                      You&apos;ll be able to run the agent on your own computer
                      using a small connector app. No public server needed.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                className="bg-white/10 hover:bg.white/20"
                onClick={cancelCreate}
              >
                Cancel
              </Button>
              <Button
  type="button"
  onClick={submitCreate}
  className="gap-2"
  disabled={!canPublish}
  title={
    canPublish
      ? ""
      : runtimeMode === "custom"
      ? "Enter a valid Chat endpoint URL to publish."
      : "Fill required fields to publish."
  }
>

                {editingAgentId ? (
                  "Save changes"
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Publish
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }


  // --- Home / Marketplace view ---


// ===== LIVE METRICS (one source of truth) =====

// 1) Total agents (всего агентов в маркетплейсе)
const totalAgents = agents.length;

// 2) Total sessions (сумма sessions по всем агентам)
const totalSessions = agents.reduce((sum, a) => sum + (a.sessions || 0), 0);

// 3) Volume (вариант A: объём из purchases, если purchases существует)
const volumeFromPurchases = purchases.reduce((sum, p) => sum + (p.priceUSDC || 0), 0);

// 3b) Volume (вариант B: если purchases пустой — оценка sessions * price)
const volumeEstimated = Math.round(
  agents.reduce((sum, a) => sum + (a.sessions || 0) * (a.priceUSDC || 0), 0)
);

// Итоговый volume: если purchases есть → берем purchases, иначе → estimated
const estVolume = volumeFromPurchases > 0 ? volumeFromPurchases : volumeEstimated;


return (
  <div className="min-h-screen w-screen overflow-x-hidden bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
    {/* Header */}
    <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10 pointer-events-auto">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
      <div className="flex items-center justify-between w-full">
  {/* LEFT: Brand + nav */}
  <div className="flex items-center gap-6">
    {/* Echo brand (не кнопка) */}
    <button
      type="button"
      onClick={() => (window.location.hash = "/")}
      className="
        bg-transparent border-0 p-0 appearance-none
        text-2xl font-semibold tracking-tight
        text-transparent bg-clip-text
        bg-gradient-to-r from-white via-white to-white/60
        hover:opacity-90 transition
        focus:outline-none
      "
      aria-label="Echo home"
    >
      Echo
    </button>

    {/* Learn (просто текст) */}
    <button
      type="button"
      onClick={() => (window.location.hash = "/learn")}
      className="
        bg-transparent border-0 p-0 appearance-none
        text-sm text-white/65
        hover:text-white transition
        focus:outline-none
        relative
      "
    >
      Learn
      <span className="absolute left-0 -bottom-1 h-[1px] w-full bg-white/0 hover:bg-white/40 transition" />
    </button>
  </div>

  {/* RIGHT: можно добавить что-то сбоку */}
  <div className="flex items-center gap-4">
    <span className="text-xs text-white/40 hidden sm:inline">
      beta
    </span>

    <button
      type="button"
      onClick={() => alert("Coming soon")}
      className="
        bg-transparent border-0 p-0 appearance-none
        text-sm text-white/65 hover:text-white transition
        focus:outline-none
      "
    >
      Docs
    </button>
  </div>
</div>

</div>


        <div className="flex items-center gap-2">
          {connected ? (
            <div className="flex items-center gap-2">
              {/* Wallet address – компактный неон */}
              <button
                className="
                  inline-flex items-center gap-2 px-3 h-8 rounded-lg
                  bg-gradient-to-r from-emerald-500/20 to-cyan-500/10
                  border border-emerald-400/40
                  text-xs text-emerald-100 font-medium
                  shadow-[0_0_14px_rgba(16,185,129,0.55)]
                  hover:shadow-[0_0_18px_rgba(16,185,129,0.8)]
                  hover:from-emerald-500/30 hover:to-cyan-500/20
                  transition
                "
              >
                <Wallet className="h-3.5 w-3.5" />
                <span className="font-mono">{address}</span>
              </button>

              {/* Balance – компактный стеклянный неон */}
              <div className="relative group">
                <button
                  className="
                    inline-flex items-center px-3 h-8 rounded-lg
                    bg-white/5 border border-white/20
                    text-xs text-white/80
                    shadow-[0_0_10px_rgba(148,163,184,0.35)]
                    hover:bg-white/10
                    hover:shadow-[0_0_16px_rgba(148,163,184,0.6)]
                    transition
                  "
                >
                  Balance
                </button>

                {/* Tooltip */}
                <div
                  className="
                    absolute right-0 mt-2 w-40 rounded-lg border border-white/15 
                    bg-[#050510]/95 px-3 py-2 text-xs text-white/80 shadow-xl
                    opacity-0 translate-y-1 pointer-events-none
                    group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto
                    transition-all duration-150
                  "
                >
                  <div className="flex justify-between">
                    <span className="text-white/60">SOL</span>
                    <span className="font-mono">
                      {solBalance != null ? solBalance.toFixed(4) : "--"}
                    </span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-white/60">USDC</span>
                    <span className="font-mono">
                      {usdcBalance != null ? usdcBalance.toFixed(2) : "--"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Disconnect – компактный, мягкий неон */}
              <button
                onClick={() => handleDisconnect()}
                className="
                  inline-flex items-center justify-center px-3 h-8 rounded-lg
                  bg-white/5 border border-white/25
                  text-xs text-white
                  hover:bg-white/10
                  shadow-[0_0_10px_rgba(148,163,184,0.35)]
                  hover:shadow-[0_0_16px_rgba(148,163,184,0.65)]
                  transition
                "
              >
                Disconnect
              </button>
            </div>
          ) : (
            <Button onClick={handleConnect} className="gap-2 h-8 px-3 text-xs">
              <Wallet className="h-3.5 w-3.5" /> Connect Wallet
            </Button>
          )}

          {/* Profile Menu */}
          <ProfileButton
            onNavigate={push}
            onSignOut={() => {
              handleDisconnect();
              push("/");
            }}
          />
        </div>
      </div>
    </header>

    <MarketplaceTopNav
  onPick={(tab, payload) => {
    // ALL
    if (tab === "all") {
      setExploreTab("all");
      setQuery("");
      setSortBy("recommended");
      pushExplore(push, { tab: "all" });
    }

    // TRENDING
    if (tab === "trending") {
      setExploreTab("trending");
      setQuery("");
      setSortBy("recommended");
      pushExplore(push, { tab: "trending" });
    }

    // TOP RATED
    if (tab === "top") {
      setExploreTab("top");
      setQuery("");
      setSortBy("likes_desc");
      pushExplore(push, { tab: "top", sort: "likes_desc" });
    }

    if (tab === "trending") {
      setExploreTab("trending");
      setQuery("");
      setSortBy("trending"); // ✅ ВАЖНО
      pushExplore(push, { tab: "trending", sort: "trending" });
    }
    
    // NEW
    if (tab === "new") {
      setExploreTab("new");
      setQuery("");
      setSortBy("newest"); // ✅
      pushExplore(push, { tab: "new", sort: "newest" }); // ✅
    }
    

    // CATEGORY
    if (tab === "category") {
      const cat = payload?.category;
      setExploreTab("category");
      setQuery(cat);
      setSortBy("recommended");
      pushExplore(push, { tab: "category", q: cat });
    }
  }}
/>


    {/* ================= HOME ("/") ================= */}
    
    {route === "/" && (
      <div className="bg-gradient-to-b from-black via-[#020617] to-black">    

        {/* HERO (центр, крупный текст, без линий) */}
<section className="relative overflow-hidden">
  {/* фоновые свечи / свечение */}
  <div aria-hidden="true" className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.25),transparent_60%)] blur-3xl opacity-70" />

  <div aria-hidden="true" className="absolute -left-20 top-32 h-96 w-40 bg-gradient-to-b from-transparent via-cyan-400/40 to-transparent blur-3xl opacity-60 -z-10" />
  <div aria-hidden="true" className="absolute -right-20 top-20 h-96 w-40 bg-gradient-to-b from-transparent via-purple-500/40 to-transparent blur-3xl opacity-60 -z-10" />

  <div className="max-w-6xl mx-auto px-4 py-28 md:py-36 flex flex-col items-center text-center gap-8">
    
    {/* КРУПНЕЙШИЙ ЗАГОЛОВОК */}
    <motion.h1
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="text-5xl md:text-7xl lg:text-8xl font-semibold leading-tight tracking-tight"
    >
      <span className="block pb-1">Web3 marketplace</span>
      <span className="block mt-3 pb-2 text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-emerald-300 to-indigo-300 drop-shadow-[0_0_45px_rgba(34,211,238,0.7)]">
        for AI agents on Solana.
      </span>
    </motion.h1>

    {/* Подзаголовок — увеличенный */}
    <motion.p
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.35 }}
      className="mt-4 max-w-2xl text-lg md:text-xl text-white/70 leading-relaxed"
    >
      Create, publish and earn from your own AI agents — or chat with 
      the best agents in crypto, design and startup strategy. 
      Pay per session directly wallet-to-wallet in USDC.
    </motion.p>

    {/* CTA */}
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18, duration: 0.35 }}
      className="mt-6 flex flex-wrap items-center justify-center gap-4"
    >
      <Button
        className="gap-3 px-7 py-3 text-lg"
        onClick={() => {
          push("/explore");
          requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
        }}
      >
        <Play className="h-5 w-5" />
        Explore agents
      </Button>

      <Button
        variant="secondary"
        className="bg-white/10 hover:bg-white/20 gap-3 px-6 py-3 text-lg"
        onClick={handleStartCreate}
      >
        <Sparkles className="h-5 w-5" />
        Become a creator
      </Button>
    </motion.div>

    {/* Маленький бейдж */}
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.26, duration: 0.35 }}
      className="mt-3 text-xs md:text-sm text-white/40 tracking-[0.25em]"
    >
      ECHO • BUILT ON SOLANA • PAY-PER-SESSION
    </motion.div>
  </div>
</section>

{/* ================= HOME · MARKETPLACE ROWS ================= */}
<section className="relative">
  {/* мягкий фон-переход между секциями */}
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 -z-10 opacity-60
    bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.14),transparent_55%),
        radial-gradient(circle_at_80%_40%,rgba(168,85,247,0.12),transparent_55%),
        radial-gradient(circle_at_40%_90%,rgba(34,197,94,0.10),transparent_60%)]"
  />

  <div className="max-w-7xl mx-auto px-4 py-16 space-y-14">

  <MarketplaceRail
  railId="trending"
  kicker="Marketplace"
  title={<><span className="mr-2">🔥</span>Trending now</>}
  subtitle="Agents people are actively chatting with right now."
  items={trendingAgents}
  badge={(a) => (a.sessions > 1000 ? "Hot" : undefined)}
  onOpen={(a) => openAgentView(a.id)}
  onChat={(a) => openPay(a)}
/>

<MarketplaceRail
  railId="toprated"
  kicker="Community"
  title={<><span className="mr-2">⭐</span>Top rated</>}
  subtitle="Highest liked agents across the marketplace."
  items={topRatedAgents}
  badge={(a) => (a.likes > 1500 ? "Top" : undefined)}
  onOpen={(a) => openAgentView(a.id)}
  onChat={(a) => openPay(a)}
/>

<MarketplaceRail
  railId="new"
  kicker="Explore"
  title={<><span className="mr-2">🆕</span>New agents</>}
  subtitle="Recently published agents you can try first."
  items={newAgents}
  badge={() => "New"}
  onOpen={(a) => openAgentView(a.id)}
  onChat={(a) => openPay(a)}
/>
 

  </div>
</section>


{/* FEATURED COLLECTIONS — маркетплейс-вкладки как на Pinterest, но в нашем стиле */}
<section>
  <div className="max-w-7xl mx-auto px-4 py-10 space-y-4">
    {/* Заголовок */}
    <div className="flex items-center justify-between gap-2">
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
          FEATURED COLLECTIONS
        </div>
        <h2 className="text-2xl md:text-3xl font-semibold text-white">
          Curated agent collections for this season.
        </h2>
      </div>
      <button
        type="button"
        onClick={() => {
          push("/explore");
          requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
        }}
        className="hidden md:inline-flex text-[11px] text-white/60 hover:text-white/90 transition"
      >
        View all agents →
      </button>
    </div>

    {/* Горизонтальная лента карточек */}
    <div
      className="
        flex gap-4 overflow-x-auto pb-2
        [-webkit-overflow-scrolling:touch]
        scroll-smooth hide-scrollbar
      "
    >
      {homeCollections.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => {
            push(`/explore?collection=${encodeURIComponent(c.id)}`);
            requestAnimationFrame(() => {
              window.scrollTo({ top: 0, left: 0, behavior: "auto" });
            });
          }}
          className="
            group shrink-0 w-[220px] sm:w-[260px] text-left
            rounded-[26px] bg-white/[0.02] border border-white/12
            hover:border-white/30 hover:bg-white/[0.05]
            transition shadow-[0_18px_40px_rgba(15,23,42,0.7)]
          "
        >
          {/* Крупный «cover» как картинка, но градиентом */}
          <div className="rounded-[22px] m-2 mb-0 overflow-hidden">
            <div
              className={`
                relative h-40 w-full
                bg-gradient-to-br ${c.accent}
                flex items-center justify-center
              `}
            >
              {/* Подложка/блик */}
              <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.5),transparent_55%)]" />
              <div className="relative text-5xl md:text-6xl drop-shadow-[0_0_40px_rgba(15,23,42,0.9)]">
                {c.emoji}
              </div>
            </div>
          </div>

          {/* Подписи ниже, как на Pinterest */}
          <div className="px-4 py-3 space-y-1">
            <div className="text-sm md:text-base font-semibold text-white line-clamp-2">
              {c.title}
            </div>
            <div className="text-xs text-white/65 line-clamp-2">
              {c.subtitle}
            </div>
          </div>

          {/* Небольшая полоска снизу — прогресс/акцент */}
          <div className="px-4 pb-3">
            <div className="h-[2px] w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-1/2 bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 group-hover:w-4/5 transition-[width] duration-300" />
            </div>
          </div>
        </button>
      ))}
    </div>
  </div>
</section>



{/* BIG METRICS SECTION – SOLANA STYLE + ANIMATION */}
<motion.section
  className="relative py-32 md:py-44 overflow-hidden"
  initial={{ opacity: 0, y: 40 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.3 }}
  transition={{ duration: 0.6 }}
>
  {/* Плавные солана-подсветки */}
  <div
    aria-hidden="true"
    className="absolute inset-0 -z-10 bg-gradient-to-b 
               from-transparent via-[#0b1220] to-black"
  />

  <div
    aria-hidden="true"
    className="absolute -top-40 left-1/2 -translate-x-1/2 
               h-[480px] w-[480px] 
               bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.28),transparent_65%)] 
               blur-3xl opacity-70"
  />

  <div
    aria-hidden="true"
    className="absolute top-20 right-1/3 
               h-[320px] w-[260px] rotate-12 
               bg-[radial-gradient(circle_at_center,_rgba(167,139,250,0.25),transparent_70%)] 
               blur-3xl opacity-60"
  />

  <div className="max-w-7xl mx-auto px-6 md:px-10 grid md:grid-cols-2 gap-20 items-center">
    
    {/* LEFT TEXT BLOCK — увеличенный + анимация */}
    <div className="space-y-6">
      <motion.h2
        className="text-4xl md:text-5xl lg:text-6xl font-semibold leading-tight"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.45 }}
      >
        Join a community
        <br />
        <span className="text-white/90">of on-chain agents.</span>
      </motion.h2>

      <motion.p
        className="text-lg md:text-xl text-white/70 max-w-lg leading-relaxed"
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.45, delay: 0.08 }}
      >
        Echo is a marketplace for AI agents with crypto-native
        payments. Real-time stats from the marketplace.
      </motion.p>

      <motion.div
        className="text-xs tracking-[0.22em] text-white/40 uppercase"
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.4, delay: 0.14 }}
      >
        Live Marketplace Metrics
      </motion.div>
    </div>

    {/* RIGHT – BIGGER METRICS + по очереди выезжают */}
    <div className="grid gap-14">
      {/* Sessions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.45, delay: 0.05 }}
      >
        <div className="text-5xl md:text-6xl lg:text-7xl font-semibold 
                        text-transparent bg-clip-text 
                        bg-gradient-to-r from-fuchsia-400 via-sky-400 to-cyan-300">
          {totalSessions.toLocaleString()}+
        </div>
        <div className="mt-2 text-sm md:text-base text-white/60 tracking-wider uppercase">
          Sessions run across agents
        </div>
      </motion.div>

      {/* Unique agents */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.45, delay: 0.12 }}
      >
        <div className="text-5xl md:text-6xl lg:text-7xl font-semibold 
                        text-transparent bg-clip-text 
                        bg-gradient-to-r from-sky-400 to-cyan-300">
{totalAgents.toLocaleString()}+

        </div>
        <div className="mt-2 text-sm md:text-base text-white/60 tracking-wider uppercase">
          Unique agents online
        </div>
      </motion.div>

      {/* Volume */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.45, delay: 0.19 }}
      >
        <div className="text-5xl md:text-6xl lg:text-7xl font-semibold 
                        text-transparent bg-clip-text 
                        bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300">
          ~{estVolume.toLocaleString()} USDC
        </div>
        <div className="mt-2 text-sm md:text-base text-white/60 tracking-wider uppercase">
          Total volume
        </div>
      </motion.div>
    </div>
  </div>
</motion.section>


        {/* ТРИ КАРТОЧКИ «USERS / CREATORS / ON SOLANA» — SOLANA FOUNDATION STYLE */}
<section>
  <div className="max-w-7xl mx-auto px-4 py-12 space-y-6">
    {/* Заголовок секции */}
    <div className="flex items-center justify-between gap-2">
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
          WHO IS ECHO FOR
        </div>
        <h2 className="text-xl md:text-2xl font-semibold text-white">
          Users, creators and on-chain builders.
        </h2>
      </div>
      <span className="hidden md:inline-flex text-[11px] text-white/50">
        Solana · USDC · Non-custodial
      </span>
    </div>

    {/* 3 колонки — все в одном стиле */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* USERS */}
      <div className="rounded-2xl border border-white/12 bg-white/[0.025] px-5 py-5 flex flex-col justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs text-white/60">
            <span className="h-6 w-6 rounded-full bg-cyan-500/15 border border-cyan-300/40 grid place-items-center">
              👤
            </span>
            <span className="uppercase tracking-[0.18em] text-[10px] text-white/45">
              USERS
            </span>
          </div>
          <div className="text-sm md:text-base font-semibold text-white">
            Tap into specialized AI agents.
          </div>
          <p className="text-xs md:text-sm text-white/65">
            Pay per session in USDC and chat with agents tuned for crypto,
            design, startup strategy and more.
          </p>
          <ul className="mt-1 text-[11px] text-white/60 space-y-1">
            <li>• No accounts — just Phantom</li>
            <li>• Save your favorite agents</li>
            <li>• Transparent pricing per session</li>
          </ul>
        </div>
        <div className="mt-4">
          <Button
            variant="secondary"
            className="w-full text-xs bg-white/5 hover:bg-white/10"
            onClick={() => {
              push("/explore");
              requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
            }}
          >
            Browse agents
          </Button>
        </div>
      </div>

      {/* CREATORS */}
      <div className="rounded-2xl border border-white/12 bg-white/[0.025] px-5 py-5 flex flex-col justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs text-white/60">
            <span className="h-6 w-6 rounded-full bg-fuchsia-500/15 border border-fuchsia-300/40 grid place-items-center">
              🧩
            </span>
            <span className="uppercase tracking-[0.18em] text-[10px] text-white/45">
              CREATORS
            </span>
          </div>
          <div className="text-sm md:text-base font-semibold text-white">
            Turn your prompt into revenue.
          </div>
          <p className="text-xs md:text-sm text-white/65">
            Publish agents in minutes. Use hosted engine or route all traffic
            to your own backend with tools and RAG.
          </p>
          <ul className="mt-1 text-[11px] text-white/60 space-y-1">
            <li>• Set your own price in USDC</li>
            <li>• Non-custodial payouts to your wallet</li>
            <li>• Track sessions, likes and revenue</li>
          </ul>
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1 text-xs"
            onClick={handleStartCreate}
          >
            Create agent
          </Button>
          <Button
            variant="secondary"
            className="flex-1 text-xs bg-white/5 hover:bg-white/10"
            onClick={() => push("/learn")}
          >
            Learn more
          </Button>
        </div>
      </div>

      {/* SOLANA / WALLET */}
      <div className="rounded-2xl border border-white/12 bg-white/[0.025] px-5 py-5 flex flex-col justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs text-white/60">
            <span className="h-6 w-6 rounded-full bg-emerald-500/15 border border-emerald-300/40 grid place-items-center">
              ⚡
            </span>
            <span className="uppercase tracking-[0.18em] text-[10px] text-white/45">
              ON SOLANA
            </span>
          </div>
          <div className="text-sm md:text-base font-semibold text-white">
            Fast, cheap, non-custodial.
          </div>
          <p className="text-xs md:text-sm text-white/65">
            USDC on Solana gives instant low-fee transfers from users to
            creators. Connect Phantom and you&apos;re in.
          </p>
          <div className="mt-3 rounded-2xl bg-black/60 border border-white/15 px-4 py-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-white/60">SOL</span>
              <span className="font-mono text-white/90">
                {solBalance != null ? solBalance.toFixed(4) : "--"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">USDC</span>
              <span className="font-mono text-white/90">
                {usdcBalance != null ? usdcBalance.toFixed(2) : "--"}
              </span>
            </div>
          </div>
        </div>
        <div className="mt-4">
          {connected ? (
            <Button
              variant="secondary"
              className="w-full text-xs bg-white/5 hover:bg-white/10"
              onClick={handleDisconnect}
            >
              Disconnect wallet
            </Button>
          ) : (
            <Button
              className="w-full text-xs"
              onClick={handleConnect}
            >
              <Wallet className="h-4 w-4 mr-1" />
              Connect Phantom
            </Button>
          )}
        </div>
      </div>
    </div>
  </div>
</section>
      </div>
    )}

          

    {/* ================= EXPLORE ("/explore") ================= */}
    {route.startsWith("/explore") && ( 

      <>
      {/* Explore Title (no rails) */}
<section className="border-t border-white/10">
  <div className="max-w-7xl mx-auto px-4 py-10">
    <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
      Explore
    </div>

    <h1 className="mt-2 text-4xl md:text-5xl font-semibold">
      {(() => {
        // если пришли с category/collection/top/new/trending — показываем красивое имя
        const sp = getHashQueryParams();
        const tab = (sp.get("tab") as ExploreTab) || "all";

        if (tab === "trending") return "Trending";
        if (tab === "top") return "Top rated";
        if (tab === "new") return "New agents";

        // category: берём q
        if (tab === "category") {
          const q = sp.get("q") || query || "All agents";
          return q.charAt(0).toUpperCase() + q.slice(1);
        }

        // коллекции (если используешь collection=...)
        const col = sp.get("collection");
        if (col) {
          const found = homeCollections.find(c => c.id === col);
          return found?.title || "Collection";
        }

        return "All agents";
      })()}
    </h1>

    <div className="mt-3 text-white/60 max-w-2xl">
      {sorted.length} agents found
    </div>
  </div>
</section>

        {/* Search & Filters */}
        <section className="border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div className="flex-1 flex gap-3">
            <Input
  placeholder="Search agents (crypto, design, mentor...)"
  value={query}
  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
    setQuery(e.target.value)
  }
  className="bg-white/5 border-white/10"
/>


              {/* Sort selector */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="h-10 rounded-md bg-white/5 border border-white/10 px-3 text-sm"
                >
                  <option value="recommended">recommended</option>
                  <option value="newest">newest</option> 
                  <option value="likes_desc">likes (high → low)</option>
                  <option value="sessions_desc">sessions (high → low)</option>
                  <option value="price_low">price (low → high)</option>
                  <option value="price_high">price (high → low)</option>
                  <option value="name_az">name (A → Z)</option>
                </select>
              </div>
            </div>

            {/* Счётчик агентов справа */}
            <div className="text-sm text-white/60">{sorted.length} agents</div>
          </div>
        </section>

        {/* Active Sessions Section */}
        {(() => {
          const activeSessions = getAllActiveSessions(agents);
          if (activeSessions.length === 0) return null;
          
          return (
            <section className="border-t border-white/10 pt-6">
              <div className="max-w-7xl mx-auto px-4 pb-6">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-white">Active Sessions</h2>
                  <p className="text-sm text-white/60 mt-1">Continue your conversations</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {activeSessions.map(({ agent, session }) => {
                    const timeLeft = session.expiresAt 
                      ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 60000))
                      : null;
                    
                    return (
                      <Card
                        key={agent.id}
                        className="rounded-2xl border border-white/10 bg-white/[.03] hover:bg-white/[.06] transition"
                      >
                        <CardHeader className="flex-row items-center gap-3 pb-2">
                          <div className="h-11 w-11 rounded-xl grid place-items-center text-xl bg-white/10">
                            {agent.avatar}
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base break-words">{agent.name}</CardTitle>
                            <CardDescription className="text-white/60 break-words text-xs line-clamp-2">
                              {agent.tagline}
                            </CardDescription>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="text-xs text-white/60">
                            {timeLeft !== null 
                              ? timeLeft > 0 
                                ? `Time left: ${timeLeft} min`
                                : "Session expired"
                              : "Active"}
                          </div>
                          <div className="text-xs text-white/50 truncate">
                            {agent.promptPreview}
                          </div>
                        </CardContent>
                        <CardFooter>
                          <Button
                            className="w-full py-2 gap-2"
                            onClick={() => {
                              setSelected(agent);
                              push(`/chat?id=${encodeURIComponent(agent.id)}`);
                            }}
                          >
                            <Bot className="h-4 w-4" />
                            Resume Session
                          </Button>
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })()}
        
        {/* Agents Grid */}
        <section>
          <div className="max-w-7xl mx-auto px-4 pb-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {loadingGrid ? (
              // Skeleton cards
              Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/10 bg-white/[.03] overflow-hidden animate-pulse"
                >
                  <div className="p-4 border-b border-white/10 flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl bg-white/10" />
                    <div className="flex-1">
                      <div className="h-4 w-32 bg-white/10 rounded mb-2" />
                      <div className="h-3 w-40 bg-white/10 rounded" />
                    </div>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="h-3 w-24 bg-white/10 rounded" />
                    <div className="flex gap-2">
                      <div className="h-5 w-16 bg-white/10 rounded" />
                      <div className="h-5 w-14 bg-white/10 rounded" />
                    </div>
                    <div className="h-3 w-3/4 bg-white/10 rounded" />
                  </div>
                  <div className="p-4 border-t border-white/10 flex items-center justify-between">
                    <div className="h-4 w-28 bg-white/10 rounded" />
                    <div className="h-8 w-20 bg-white/10 rounded" />
                  </div>
                </div>
              ))
            ) : (
              sorted.map((a, idx) => {
                const isTop = topRatedIds.has(a.id);

                const cardInner = (
                  <Card
                    className={cx(
                      "rounded-2xl border-white/10 bg-white/[.03]",
                      "transition-transform duration-200 hover:-translate-y-1 hover:bg-white/[.06]",
                      "hover:shadow-[0_0_38px_rgba(56,189,248,0.45)]",
                      isTop && "border-transparent"
                    )}
                  >
                    <CardHeader className="flex-row items-center gap-3 pb-2">
                      <div
                        className={cx(
                          "h-11 w-11 rounded-xl grid place-items-center text-xl bg-white/10",
                          "transition-colors duration-200 group-hover:bg-white/20"
                        )}
                      >
                        {a.avatar}
                      </div>
                      <div className="space-y-1">
                        <CardTitle className="text-base flex items-center gap-2 break-words">
                          <span className="break-words">{a.name}</span>
                          {isTop && (
                            <span className="text-[10px] uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-400/30 px-1.5 py-0.5 rounded">
                              Top Rated
                            </span>
                          )}
                        </CardTitle>

                        <CardDescription className="text-white/60 break-words">
                          {a.tagline}
                        </CardDescription>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-white/70">
                        <Heart className="h-4 w-4 text-rose-400" />
                        {a.likes.toLocaleString()} likes •{" "}
                        {a.sessions.toLocaleString()} sessions
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {a.categories.map((c) => (
                          <Badge
                            key={c}
                            className="bg-white/10 border-white/10"
                          >
                            {c}
                          </Badge>
                        ))}
                      </div>
                      <div className="text-xs text-white/50 truncate">
                        {a.promptPreview}
                      </div>
                    </CardContent>

                    <CardFooter className="space-y-3">
                      {/* Price */}
                      <div className="text-sm font-medium">
                        {formatUSDC(a.priceUSDC)} / session
                      </div>

                      {/* First row — small buttons */}
                      <div className="flex gap-2">
                        {/* Like */}
                        <Button
                          variant="secondary"
                          className={cx(
                            "px-3 py-1 group/like transition-colors",
                            liked[a.id]
                              ? "text-rose-300 border-rose-400/40 bg-rose-500/15"
                              : ""
                          )}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            handleLike(a.id);
                          }}
                          aria-pressed={!!liked[a.id]}
                        >
                          <Heart
                            className={cx(
                              "h-4 w-4 mr-1 transition-transform group-active:scale-95",
                              liked[a.id]
                                ? "fill-rose-500 text-rose-500"
                                : ""
                            )}
                          />
                          Like
                        </Button>

                        {/* Save */}
                        <Button
                          variant="secondary"
                          className={cx(
                            "px-3 py-1 text-xs transition-colors",
                            saved[a.id]
                              ? "bg-emerald-500/20 border border-emerald-400/60 text-emerald-200"
                              : "bg-white/10 hover:bg-white/20"
                          )}
                          onClick={() => toggleSaved(a.id)}
                        >
                          {saved[a.id] ? "Saved" : "Save"}
                        </Button>

                        {/* View */}
                        <Button
                          variant="secondary"
                          className="px-3 py-1"
                          onClick={() => openAgentView(a.id)}
                        >
                          View
                        </Button>
                      </div>
                      
                      {/* Chat / Continue */}
                      {(() => {
                        const hasActiveSession = typeof window !== "undefined" ? !!getActiveSession(a.id) : false;
                        return (
                          <Button
                            className="w-full py-2 text-base gap-2"
                            onClick={() => openPay(a)}
                          >
                            <Bot className="h-4 w-4" />
                            {hasActiveSession ? "Continue" : "Chat"}
                          </Button>
                        );
                      })()}
                    </CardFooter>
                  </Card>
                );

                return (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="group relative"
                  >
                    {isTop ? (
                      <div className="rounded-2xl p-[1.5px] bg-gradient-to-r from-orange-500 via-amber-400 to-orange-600">
                        <div className="rounded-2xl bg-[#0b0b1a]">
                          {cardInner}
                        </div>
                      </div>
                    ) : (
                      cardInner
                    )}
                  </motion.div>
                );
              })
            )}
          </div>
        </section>
      </>
    )}


    {/* Pay Modal — only shown when payModalOpen is true */}
    {payModalOpen && selected && (
      <div
        className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md grid place-items-center p-4 pointer-events-auto"
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          // Close modal when clicking backdrop (outside the card)
          if (e.target === e.currentTarget) {
            closePay();
          }
        }}
      >
        <Card className="w-full max-w-md bg-[#0c0c18]/95 border-white/15 shadow-2xl">
          <CardHeader className="flex-row items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl grid place-items-center text-lg bg-white/10">
                {selected.avatar}
              </div>
              <div>
                <CardTitle className="text-lg">{selected.name}</CardTitle>
                <CardDescription className="text-white/60">
                  {selected.tagline}
                </CardDescription>
              </div>
            </div>
            <Button
              variant="secondary"
              className="text-white/80"
              onClick={() => closePay()}
            >
              <X className="h-5 w-5" />
            </Button>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/70">Price per session</div>
              <div className="font-medium">
                {formatUSDC(selected.priceUSDC)}
              </div>
            </div>

            {!connected ? (
              <Button onClick={() => handleConnect()} className="w-full gap-2">
                <Wallet className="h-4 w-4" /> Connect Wallet to Proceed
              </Button>
            ) : modalState === "creator_free" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-cyan-300 text-sm">
                  You're the creator of this agent. Your sessions are free.
                </div>
                <Button
                  variant="secondary"
                  className="w-full bg-white/10 hover:bg-white/20"
                  onClick={() => startChat()}
                >
                  Start Chat
                </Button>
              </div>
            ) : modalState === "free" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 p-3 text-cyan-100 text-sm">
                  This agent is free. Start chatting now!
                </div>
                <Button
                  variant="secondary"
                  className="w-full bg-white/10 hover:bg-white/20"
                  onClick={() => startChat()}
                >
                  Start Chat
                </Button>
              </div>
            ) : modalState === "missing_payout_wallet" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-red-200 text-sm">
                  This agent has no payout wallet linked. The creator must
                  connect a Phantom wallet before this agent can accept
                  payments.
                </div>
                <Button
                  variant="secondary"
                  className="w-full bg-white/10 hover:bg-white/20"
                  disabled
                >
                  Payment Unavailable
                </Button>
              </div>
            ) : modalState === "paid" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-300 text-sm">
                  Payment confirmed. Session unlocked.
                </div>
                <Button
                  variant="secondary"
                  className="w-full bg-white/10 hover:bg-white/20"
                  onClick={() => startChat()}
                >
                  Start Chat
                </Button>
              </div>
            ) : modalState === "processing" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-blue-400/40 bg-blue-500/10 p-3 text-blue-200 text-sm">
                  Processing payment... Please confirm in Phantom wallet.
                </div>
                <Button
                  variant="secondary"
                  className="w-full bg-white/10 hover:bg-white/20"
                  disabled
                >
                  Processing...
                </Button>
              </div>
            ) : modalState === "error" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-red-200 text-sm">
                  Payment failed. Please try again.
                </div>
                <Button
                  variant="secondary"
                  className="w-full bg-white/10 hover:bg-white/20"
                  onClick={() => setModalState("ready")}
                >
                  Try Again
                </Button>
              </div>
            ) : modalState === "ready" ? (
              <div className="space-y-3">
                <PhantomPayButton
                  amountUsdc={selected.priceUSDC}
                  recipient={selected.creatorWallet}
                  onProcessing={() => setModalState("processing")}
                  onError={() => setModalState("error")}
                  onSuccess={async (sig: string) => {
                    if (!selected || !walletPk) return;

                    // ✅ Verify payment on-chain (no external server needed)
                    const verification = await verifyPaymentOnChain(
                      sig,
                      selected.creatorWallet!,
                      selected.priceUSDC,
                      walletPk
                    );

                    if (!verification.valid) {
                      setModalState("error");
                      alert(
                        "Payment verification failed: " + (verification.reason || "Unknown error")
                      );
                      return;
                    }

                    // ✅ Payment verified — save session
                    saveSession(selected, sig);
                    setModalState("paid");
                  }}
                  className="w-full"
                />

                <div className="text-xs text-white/50">
                  USDC transfer on Solana mainnet.
                </div>
                
                {/* Preview domain warning */}
                {typeof window !== "undefined" && window.location.hostname.includes("vercel.app") && (
                  <div className="text-[10px] text-amber-400/70 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5 mt-1">
                    ⚠️ Preview domain detected. Phantom may show a security warning. For trusted payments, use our official domain.
                  </div>
                )}
              </div>
            ) : (
              // Fallback for "idle" or unknown state - show ready
              <div className="space-y-3">
                <PhantomPayButton
                  amountUsdc={selected.priceUSDC}
                  recipient={selected.creatorWallet}
                  onProcessing={() => setModalState("processing")}
                  onError={() => setModalState("error")}
                  onSuccess={async (sig: string) => {
                    if (!selected || !walletPk) return;

                    const verification = await verifyPaymentOnChain(
                      sig,
                      selected.creatorWallet!,
                      selected.priceUSDC,
                      walletPk
                    );

                    if (!verification.valid) {
                      setModalState("error");
                      alert(
                        "Payment verification failed: " + (verification.reason || "Unknown error")
                      );
                      return;
                    }

                    saveSession(selected, sig);
                    setModalState("paid");
                  }}
                  className="w-full"
                />

                <div className="text-xs text-white/50">
                  USDC transfer on Solana mainnet.
                </div>
                
                {/* Preview domain warning */}
                {typeof window !== "undefined" && window.location.hostname.includes("vercel.app") && (
                  <div className="text-[10px] text-amber-400/70 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5 mt-1">
                    ⚠️ Preview domain detected. Phantom may show a security warning. For trusted payments, use our official domain.
                  </div>
                )}
              </div>
            )}

            <div className="text-xs text-white/50">
              Payments are processed securely via Solana blockchain.
            </div>
          </CardContent>
        </Card>
      </div>
    )}

    {/* Footer */}
    <footer className="border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-8">
          {/* Brand */}
          <div className="md:col-span-1 flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-gradient-to-r from-cyan-400/20 via-indigo-400/20 to-emerald-400/20 border border-white/10 grid place-items-center">
              <Bot className="h-4 w-4" />
            </div>
            <div className="text-white text-lg font-semibold">Echo</div>
          </div>

          {/* Company */}
          <div>
            <div className="text-white font-medium mb-3">Company</div>
            <ul className="space-y-2 text-sm text-white/70">
              <li>
                <a href="#/about" className="hover:text-white transition">
                  About Us
                </a>
              </li>
              <li>
                <a href="#/contact" className="hover:text-white transition">
                  Contact
                </a>
              </li>
            </ul>
          </div>

          {/* Help & Support */}
          <div>
            <div className="text-white font-medium mb-3">Help & Support</div>
            <ul className="space-y-2 text-sm text-white/70">
              <li>
                <a href="#/learn" className="hover:text-white transition">
                  Learn
                </a>
              </li>
              <li>
                <a href="#/docs" className="hover:text-white transition">
                  Documentation
                </a>
              </li>
              <li>
                <a href="mailto:support@echo.app" className="hover:text-white transition">
                  Support
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <div className="text-white font-medium mb-3">Resources</div>
            <ul className="space-y-2 text-sm text-white/70">
              <li>
                <a href="https://phantom.app" target="_blank" rel="noreferrer" className="hover:text-white transition">
                  Get Phantom Wallet
                </a>
              </li>
              <li>
                <a href="https://solana.com" target="_blank" rel="noreferrer" className="hover:text-white transition">
                  About Solana
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <div className="text-white font-medium mb-3">Legal</div>
            <ul className="space-y-2 text-sm text-white/70">
              <li>
                <a href="#/terms" className="hover:text-white transition">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#/privacy" className="hover:text-white transition">
                  Privacy Policy
                </a>
              </li>
            </ul>
          </div>

          {/* Socials */}
          <div className="md:col-span-1 md:justify-self-end flex items-start md:items-center gap-4">
            <a
              href="https://x.com/echo_ai"
              target="_blank"
              rel="noreferrer"
              className="text-white/70 hover:text-white transition"
              aria-label="Twitter"
            >
              <Twitter className="h-5 w-5" />
            </a>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-4 flex flex-col md:flex-row items-center justify-between text-sm text-white/60">
          <div>© 2025 Echo. All rights reserved.</div>
          <div className="flex gap-6 mt-2 md:mt-0">
            <a href="#/terms" className="hover:text-white transition">
              Terms
            </a>
            <a href="#/privacy" className="hover:text-white transition">
              Privacy
            </a>
            <a href="#/about" className="hover:text-white transition">
              About
            </a>
          </div>
        </div>
      </div>
    </footer>
  </div>
);
}
function AgentCard({
  agent,
  onOpen,
  onChat,
}: {
  agent: Agent;
  onOpen: () => void;
  onChat: () => void;
}) {
  return (
    <Card className="rounded-2xl border border-white/10 bg-white/[.04] hover:bg-white/[.07] transition">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white/10 grid place-items-center text-lg">
            {agent.avatar}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{agent.name}</div>
            <div className="text-xs text-white/60 truncate">{agent.tagline}</div>
          </div>
        </div>

        <div className="text-xs text-white/60">
          {agent.sessions.toLocaleString()} sessions • {agent.likes.toLocaleString()} likes
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">{formatUSDC(agent.priceUSDC)}</div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs bg-white/10 hover:bg-white/20"
              onClick={onOpen}
            >
              View
            </Button>
            <Button className="h-8 px-3 text-xs" onClick={onChat}>
              Chat
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Phantom Pay Button (USDC SPL token, Devnet) ---
function PhantomPayButton({
  amountUsdc = 0.5,          // СКОЛЬКО USDC списываем
  recipient,
  onSuccess,
  onProcessing,
  onError,
  className = "",
}: {
  amountUsdc?: number;       // в нормальных единицах, типа 0.30
  recipient?: string;        // кому платим (creatorWallet)
  onSuccess?: (sig: string) => void;
  onProcessing?: () => void;
  onError?: () => void;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handlePay() {
    // Ensure we're in browser
    if (typeof window === "undefined") {
      alert("This feature requires a browser environment.");
      return;
    }

    try {
      setLoading(true);
      onProcessing && onProcessing();

      const anyWin = window as any;
      const provider = anyWin?.solana;
      if (!provider || !provider.isPhantom) {
        alert("Phantom wallet not found. Please install Phantom.");
        onError && onError();
        setLoading(false);
        return;
      }

      // Check if already connected, otherwise connect
      let publicKey = provider.publicKey;
      if (!publicKey) {
        try {
          const response = await provider.connect();
          publicKey = response.publicKey;
        } catch (connectError: any) {
          if (connectError.code === 4001) {
            // User rejected connection
            onError && onError();
            setLoading(false);
            return;
          }
          throw connectError;
        }
      }

      // Validate recipient
      if (!recipient) {
        alert("This agent has no payout wallet configured. Payment is disabled.");
        onError && onError();
        setLoading(false);
        return;
      }

      // Determine if we should use proxy (production) or direct connection
      const isProduction = typeof window !== "undefined" && 
        (window.location.hostname.includes("vercel.app") || 
         window.location.hostname.includes("vercel.com") ||
         import.meta.env.PROD);

      const fromPubkey = new PublicKey(publicKey.toString());
      const toPubkey = new PublicKey(recipient);
      const mint = new PublicKey(USDC_MINT);

      // USDC has 6 decimals
      const DECIMALS = 6;
      const rawAmount = Math.round(amountUsdc * 10 ** DECIMALS); // e.g., 0.30 → 300000

      // Get associated token accounts for sender and recipient
      // For ATA lookup, we can use a direct connection temporarily or proxy
      const connection = await getSolanaConnection();
      const fromTokenAccount = await getAssociatedTokenAddress(mint, fromPubkey);
      const toTokenAccount = await getAssociatedTokenAddress(mint, toPubkey);

      // Create SPL token transfer instruction
      const ix = createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromPubkey,
        rawAmount,
        [],
        TOKEN_PROGRAM_ID
      );

      // Create and prepare transaction
      const tx = new Transaction().add(ix);
      tx.feePayer = fromPubkey;
      
      // Get latest blockhash BEFORE opening Phantom - this ensures transaction is ready
      // This is critical: Phantom should open with a ready-to-sign transaction
      // Use proxy in production to avoid 403 errors
      let blockhash: string;
      try {
        const blockhashResult = await getLatestBlockhash(isProduction);
        blockhash = blockhashResult.blockhash;
        tx.recentBlockhash = blockhash;
      } catch (blockhashError: any) {
        console.error("Failed to get blockhash:", blockhashError);
        throw new Error(`Failed to prepare transaction: ${blockhashError.message || "RPC unavailable"}`);
      }

      // Get connection for confirmation (use proxy if in production)
      const confirmConnection = isProduction ? connection : await getSolanaConnection();

      // Now open Phantom with ready-to-sign transaction
      // signAndSendTransaction opens Phantom immediately and returns signature
      let signature: string;
      try {
        const result = await provider.signAndSendTransaction(tx);
        signature = result.signature;
      } catch (signError: any) {
        // Check if user rejected
        if (signError.code === 4001 || 
            signError.message?.includes("User rejected") ||
            signError.message?.includes("User cancelled")) {
          // User rejected - don't show error, just reset
          onError && onError();
          setLoading(false);
          return;
        }
        throw signError;
      }
      
      // Wait for confirmation (optional, but recommended)
      // Note: In production, confirmation may need to go through proxy too
      // But signAndSendTransaction returns after Phantom sends, so we can try direct confirmation
      try {
        await Promise.race([
          confirmConnection.confirmTransaction(signature, "confirmed"),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Transaction confirmation timeout")), 30000)
          )
        ]);
        console.log("Transaction confirmed:", signature);
      } catch (confirmError: any) {
        // Transaction was sent but confirmation timed out - still proceed
        // The transaction is on-chain, we just didn't wait for confirmation
        console.warn("Confirmation timeout, but transaction was sent:", signature);
      }

      // Success - call onSuccess callback
      onSuccess && onSuccess(signature);
    } catch (e: any) {
      console.error("Payment error:", e);
      
      const errorMsg = e?.message || "Unknown error";
      
      // Always call onError to reset modal state from "processing" to "error"
      onError && onError();
      
      // Handle specific error cases
      if (errorMsg.includes("User rejected") || errorMsg.includes("User cancelled") || errorMsg.includes("4001")) {
        // User cancelled - don't show error alert
        return;
      } else if (errorMsg.includes("403") || errorMsg.includes("Access forbidden") || errorMsg.includes("RPC")) {
        alert("RPC provider error. Transaction may have been sent - please check your wallet.");
      } else if (errorMsg.includes("insufficient funds") || errorMsg.includes("0x1")) {
        alert("Insufficient USDC balance. Please check your wallet.");
      } else if (errorMsg.includes("Buffer is not defined")) {
        alert("Buffer polyfill error. Please refresh the page.");
      } else {
        alert(`USDC payment failed: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      onClick={handlePay}
      className={cx("gap-2", className)}
      disabled={loading}
    >
      <Wallet className="h-4 w-4" />{" "}
      {loading ? "Processing…" : "Pay with USDC"}
    </Button>
  );
}


function MarketplaceTopNav({
  onPick,
}: {
  onPick: (tab: ExploreTab, payload?: any) => void;
}) {
  return (
    <div className="sticky top-[60px] z-30 border-b border-white/10 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4">
        {/* важно: overflow-x-auto можно, но Y должен быть visible, чтобы дропдаун НЕ скроллился и не клипался */}
        <div className="flex items-center gap-8 py-3 overflow-visible whitespace-nowrap">
          <TopNavItem onClick={() => onPick("all")}>All</TopNavItem>
          <TopNavItem onClick={() => onPick("trending")}>Trending</TopNavItem>
          <TopNavItem onClick={() => onPick("top")}>Top rated</TopNavItem>
          <TopNavItem onClick={() => onPick("new")}>New</TopNavItem>

{/* CATEGORIES */}
<div className="relative group shrink-0">
  <TopNavItem onClick={() => {}}>
    Categories
  </TopNavItem>

  {/* PANEL */}
  <div
    className="
      absolute left-0 top-full mt-3 z-50
      w-[320px]
      rounded-2xl
      border border-white/10
      bg-[#0b0b1a]/95 backdrop-blur
      shadow-2xl
      opacity-0 translate-y-1 pointer-events-none
      group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto
      transition-all duration-150
    "
  >
    {/* arrow */}
    <div
      className="
        absolute -top-2 left-6 h-4 w-4 rotate-45
        bg-[#0b0b1a]/95
        border-l border-t border-white/10
      "
    />

    {/* CONTENT */}
    <div className="py-2">
      <div className="px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-white/40">
        Categories
      </div>

      <div className="flex flex-col">
        {CATEGORY_ITEMS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick("category", { category: c.id })}
            className="
              w-full text-left
              px-4 py-3
              text-sm text-white/80
              bg-transparent
              border-0
              hover:bg-white/5 hover:text-white
              transition
            "
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  </div>
</div>



        </div>
      </div>
    </div>
  );
}

function TopNavItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        relative bg-transparent border-0 p-0 appearance-none shrink-0
        text-sm text-white/55 hover:text-white transition
        focus:outline-none
      "
    >
      {/* underline ONLY on hover */}
      <span
        className="
          relative inline-block
          after:content-[''] after:absolute after:left-0 after:-bottom-2
          after:h-[2px] after:w-full after:rounded-full after:bg-white/80
          after:scale-x-0 after:origin-left after:transition-transform after:duration-150
          hover:after:scale-x-100
        "
      >
        {children}
      </span>
    </button>
  );
}


// --- Profile components ---
function ProfileButton({
  onNavigate,
  onSignOut,
}: {
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!panelRef.current || !btnRef.current) return;
      if (!panelRef.current.contains(t) && !btnRef.current.contains(t)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  return (
    <div className="relative">
      {/* КНОПКА ПРОФИЛЯ */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open profile menu"
        className="flex items-center justify-center h-10 w-10 rounded-full
                   border border-white/15 bg-white/5 text-white
                   hover:bg-white/10 transition duration-200
                   focus:outline-none"
      >
        <User className="h-5 w-5" style={{ color: "#ffffff" }} />
      </button>

      {/* ДРОПДАУН */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 mt-2 w-64 rounded-xl border border-white/10 bg-[#0f0f1e]/95 backdrop-blur shadow-xl z-50"
        >
          <div className="p-3 border-b border-white/10">
            <div className="text-sm font-medium">Your profile</div>
            <div className="text-xs text-white/60">Manage account & agents</div>
          </div>
          <div className="p-2">
            <ProfileItem
              label="My Agents"
              onClick={() => {
                onNavigate("/profile/agents");
                setOpen(false);
              }}
            />
            <ProfileItem
  label="Saved Agents"
  onClick={() => {
    onNavigate("/profile/saved");
    setOpen(false);
  }}
/>

            <ProfileItem
              label="Purchases"
              onClick={() => {
                onNavigate("/profile/purchases");
                setOpen(false);
              }}
            />
            <ProfileItem
              label="Creator Stats"
              onClick={() => {
                onNavigate("/profile/stats");
                setOpen(false);
              }}
            />
            <div className="h-px bg-white/10 my-1" />
            <ProfileItem
              label="Sign Out"
              danger
              onClick={() => {
                onSignOut();
                setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}


function ProfileItem({ label, onClick, danger=false }: { label: string; onClick: () => void; danger?: boolean; }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "w-full text-left px-3 py-2 rounded-md text-sm transition",
        "bg-transparent appearance-none focus:outline-none", // <— добавили
        danger
          ? "text-red-300 hover:bg-red-500/10"
          : "text-white/90 hover:bg-white/10"
      )}
    >
      {label}
    </button>
  );
}

// ====================== MARKETPLACE RAIL UI (reusable) ======================

function RailHeader({
  kicker,
  title,
  subtitle,
  right,
}: {
  kicker?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-1">
        {kicker && (
          <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">
            {kicker}
          </div>
        )}
        <h2 className="text-2xl md:text-3xl font-semibold text-white">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-white/60 max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

function AgentRailCard({
  agent,
  onOpen,
  onChat,
  badge,
}: {
  agent: Agent;
  onOpen: () => void;
  onChat: () => void;
  badge?: string;
}) {
  const metric = agent.sessions + agent.likes;

  return (
    <div
      className="
        group relative shrink-0 w-[280px] sm:w-[320px]
        snap-start
      "
    >
      {/* glow */}
      <div
        aria-hidden
        className="
          pointer-events-none absolute -inset-2 -z-10 opacity-0 blur-2xl
          bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.35),transparent_60%),
              radial-gradient(circle_at_70%_70%,rgba(168,85,247,0.28),transparent_60%),
              radial-gradient(circle_at_40%_90%,rgba(34,197,94,0.18),transparent_65%)]
          group-hover:opacity-100 transition duration-300
        "
      />

      {/* gradient border */}
      <div className="rounded-[22px] p-[1px] bg-gradient-to-r from-cyan-400/35 via-fuchsia-400/25 to-emerald-300/25">
        <div
          className="
            rounded-[21px] border border-white/10
            bg-white/[0.03] backdrop-blur
            hover:bg-white/[0.055]
            transition
            shadow-[0_18px_60px_rgba(0,0,0,0.45)]
          "
        >
          {/* top */}
          <div className="p-4 pb-3 flex items-start gap-3">
            <div className="h-12 w-12 rounded-2xl bg-white/10 border border-white/10 grid place-items-center text-2xl">
              {agent.avatar}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-semibold text-white truncate">
                  {agent.name}
                </div>

                {badge && (
                  <span className="shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full
                                   bg-white/8 border border-white/12 text-white/70">
                    {badge}
                  </span>
                )}
              </div>

              <div className="text-xs text-white/60 truncate mt-0.5">
                {agent.tagline}
              </div>

              {/* categories mini */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {agent.categories.slice(0, 3).map((c) => (
                  <span
                    key={c}
                    className="text-[10px] px-2 py-0.5 rounded-full
                               bg-white/5 border border-white/10 text-white/60"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* mid metrics */}
          <div className="px-4 pb-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-black/30 border border-white/10 px-3 py-2">
                <div className="text-[10px] text-white/45 uppercase tracking-wider">
                  Sessions
                </div>
                <div className="text-sm font-semibold text-white">
                  {agent.sessions.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl bg-black/30 border border-white/10 px-3 py-2">
                <div className="text-[10px] text-white/45 uppercase tracking-wider">
                  Likes
                </div>
                <div className="text-sm font-semibold text-white">
                  {agent.likes.toLocaleString()}
                </div>
              </div>
              <div className="rounded-xl bg-black/30 border border-white/10 px-3 py-2">
                <div className="text-[10px] text-white/45 uppercase tracking-wider">
                  Price
                </div>
                <div className="text-sm font-semibold text-transparent bg-clip-text
                                bg-gradient-to-r from-emerald-300 via-cyan-300 to-fuchsia-300">
                  {formatUSDC(agent.priceUSDC)}
                </div>
              </div>
            </div>

          </div>

          {/* bottom actions */}
          <div className="px-4 pb-4 flex items-center justify-between gap-3">
            <button
              onClick={onOpen}
              className="
                flex-1 h-10 rounded-xl
                bg-white/6 border border-white/12
                text-sm text-white/80
                hover:bg-white/10 hover:text-white
                transition
              "
            >
              View
            </button>
            <button
              onClick={onChat}
              className="
                flex-1 h-10 rounded-xl
                bg-gradient-to-r from-indigo-600/90 to-fuchsia-600/90
                border border-white/10
                text-sm text-white font-medium
                shadow-[0_0_18px_rgba(99,102,241,0.35)]
                hover:shadow-[0_0_26px_rgba(168,85,247,0.45)]
                transition
              "
            >
              Chat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketplaceRail({
  kicker,
  title,
  subtitle,
  items,
  badge,
  onOpen,
  onChat,
  railId,
}: {
  kicker?: string;
  title: React.ReactNode;
  subtitle?: string;
  items: Agent[];
  badge?: (a: Agent) => string | undefined;
  onOpen: (a: Agent) => void;
  onChat: (a: Agent) => void;
  railId?: string; // unique ID for scroll position persistence
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const SCROLL = 320;
  const scrollKey = railId ? `explore_scroll_${railId}` : null;

  // ✅ прогресс скролла (для нижней линии)
  const [progress, setProgress] = useState(0);

  const scrollRow = (dir: "left" | "right") => {
    const el = rowRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -SCROLL : SCROLL, behavior: "smooth" });
  };

  // ✅ Restore scroll position on mount
  useEffect(() => {
    if (!scrollKey || typeof window === "undefined") return;
    const el = rowRef.current;
    if (!el) return;

    const saved = sessionStorage.getItem(scrollKey);
    if (saved) {
      const pos = parseInt(saved, 10);
      if (!isNaN(pos)) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          el.scrollLeft = pos;
        });
      }
    }
  }, [scrollKey]);

  // ✅ Save scroll position before navigating away
  const saveScrollPosition = () => {
    if (!scrollKey || typeof window === "undefined") return;
    const el = rowRef.current;
    if (el) {
      sessionStorage.setItem(scrollKey, String(el.scrollLeft));
    }
    // Also save vertical scroll position
    sessionStorage.setItem("exploreScrollY", String(window.scrollY));
  };

  // ✅ обновляем прогресс когда юзер скроллит ленту
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    const onScroll = () => {
      const max = el.scrollWidth - el.clientWidth;
      const p = max > 0 ? el.scrollLeft / max : 0;
      setProgress(p);
    };

    el.addEventListener("scroll", onScroll, { passive: true } as any);
    onScroll();

    return () => el.removeEventListener("scroll", onScroll as any);
  }, [items.length]);

  return (
    <section className="relative">
      {/* solana-like glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-70
        bg-[radial-gradient(circle_at_15%_10%,rgba(34,211,238,0.12),transparent_55%),
            radial-gradient(circle_at_80%_35%,rgba(99,102,241,0.10),transparent_55%),
            radial-gradient(circle_at_45%_95%,rgba(16,185,129,0.10),transparent_60%)]"
      />

      {/* ✅ ВАЖНО: фиксирует “съехало” (ограничиваем ширину как везде на сайте) */}
      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* header */}
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            {kicker && (
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">
                {kicker}
              </div>
            )}

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="text-2xl md:text-3xl font-semibold leading-tight"
            >
              {title}
            </motion.h2>

            {subtitle && (
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
                className="mt-1 text-sm text-white/60 max-w-2xl"
              >
                {subtitle}
              </motion.p>
            )}
          </div>

          {/* arrows */}
          <div className="hidden md:flex items-center gap-2 self-center">
          <button
  type="button"
  onClick={() => scrollRow("left")}
  className="
    h-10 w-10 rounded-full
    border border-white/20 bg-black/60
    flex items-center justify-center
    text-white text-xl
    leading-none
    hover:bg-white/10 transition
    relative
  "
>
  <span className="relative left-[0.5px]">‹</span>
</button>




<button
  type="button"
  onClick={() => scrollRow("right")}
  className="
    h-10 w-10 rounded-full
    border border-white/20 bg-black/60
    flex items-center justify-center
    text-white text-xl
    leading-none
    hover:bg-white/10 transition
  "
>
  <span className="relative right-[0.5px]">›</span>
</button>


</div>

        </div>

        {/* rail */}
        <div className="relative">
          {/* лёгкие fade по краям (чтобы не выглядело “скудно”) */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-full w-10 z-10
                       bg-gradient-to-r from-black/60 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 h-full w-10 z-10
                       bg-gradient-to-l from-black/60 to-transparent"
          />

          <div
            ref={rowRef}
            className="
              flex gap-5
              overflow-x-auto scroll-smooth
              pb-5 pt-2
              [-webkit-overflow-scrolling:touch]
              snap-x snap-mandatory
              hide-scrollbar
            "
          >
            {items.map((a, idx) => (
              <motion.button
                key={a.id}
                type="button"
                onClick={() => {
                  saveScrollPosition();
                  onOpen(a);
                }}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.35, ease: "easeOut", delay: Math.min(0.18, idx * 0.03) }}
                whileHover={{ y: -4 }}
                className="
                  group shrink-0 w-[260px] snap-start
                  text-left rounded-2xl
                  border border-white/12
                  bg-white/[0.035]
                  hover:bg-white/[0.06]
                  hover:border-white/25
                  transition
                  shadow-[0_18px_50px_rgba(2,6,23,0.65)]
                "
              >
                {/* top mini cover */}
                <div className="relative h-20 rounded-t-2xl overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/18 via-indigo-400/14 to-emerald-400/14" />
                  <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.22),transparent_55%)]" />

                  <div className="absolute left-4 top-4 h-10 w-10 rounded-xl bg-black/40 border border-white/15 grid place-items-center text-xl">
                    {a.avatar}
                  </div>

                  {badge?.(a) && (
                    <div
                      className="
                        absolute right-3 top-3 text-[10px] uppercase tracking-wider
                        rounded-full px-2 py-1
                        bg-black/55 border border-white/15 text-white/80
                      "
                    >
                      {badge(a)}
                    </div>
                  )}
                </div>

                {/* body */}
                <div className="px-4 pt-3 pb-4">
                  <div className="font-semibold text-white line-clamp-1">{a.name}</div>
                  <div className="text-xs text-white/60 line-clamp-2 mt-1">{a.tagline}</div>

                  <div className="mt-3 flex items-center justify-between text-xs text-white/60">
                    <span>{a.sessions.toLocaleString()} sessions</span>
                    <span>{a.likes.toLocaleString()} likes</span>
                  </div>

                  {/* actions */}
                  <div className="mt-4 flex items-center gap-2">
                    <div className="text-sm font-semibold text-white/90">
                      {formatUSDC(a.priceUSDC)}
                    </div>
                    <div className="flex-1" />

                    {(() => {
                      const hasActiveSession = typeof window !== "undefined" ? !!getActiveSession(a.id) : false;
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            saveScrollPosition();
                            onChat(a);
                          }}
                          className="
                            h-9 px-3 rounded-xl text-sm font-medium
                            bg-gradient-to-r from-cyan-400/70 via-indigo-400/65 to-emerald-400/60
                            border border-white/10
                            shadow-[0_0_18px_rgba(99,102,241,0.18)]
                            hover:shadow-[0_0_28px_rgba(34,211,238,0.20)]
                            transition
                          "
                        >
                          {hasActiveSession ? "Continue" : "Chat"}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              </motion.button>
            ))}
          </div>

          {/* ✅ ВОТ ОНА: глобальная линия прогресса (движется при скролле) */}
          <div className="mt-3 h-[2px] w-full rounded-full bg-white/10 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-emerald-400"
              animate={{ width: `${Math.max(18, progress * 100)}%` }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}


function MarketplaceTopTags({
  activeId,
  tags,
  onPick,
}: {
  activeId: string | null;
  tags: { id: string; label: string; emoji?: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="sticky top-[60px] z-30 border-b border-white/10 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4">
        <div
          className="
            flex items-center gap-6 py-3
            overflow-x-auto whitespace-nowrap
            [-webkit-overflow-scrolling:touch]
            hide-scrollbar
          "
        >
          {tags.map((t) => {
            const isActive = (activeId ?? "all") === t.id;

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t.id)}
                className={[
                  "shrink-0 bg-transparent border-0 p-0 appearance-none",
                  "text-sm text-white/55 hover:text-white transition",
                  "focus:outline-none",
                  // если очень длинные названия — не ломаем верстку
                  "max-w-[220px] truncate",
                  isActive ? "text-white" : "",
                ].join(" ")}
              >
                <span className="relative">
                  {t.emoji ? `${t.emoji} ` : ""}
                  {t.label}
                  {/* underline для активного */}
                  {isActive && (
                    <span className="absolute left-0 -bottom-2 h-[2px] w-full bg-white/80 rounded-full" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}







// --- Chat page with persistent history + timer/limits + creator unlock ---
// --- Chat page with persistent history + timer/limits + creator unlock + file uploads ---

// Import IndexedDB attachment storage
import { putAttachment, getAttachmentBlob, deleteAttachments } from "./lib/attachmentStore";

// Attachment metadata (persisted in localStorage with messages)
// Actual blob data is stored in IndexedDB by id
type ChatAttachment = {
  id: string;
  name: string;
  mime: string;        // e.g., "image/jpeg", "application/pdf"
  size: number;        // bytes
  kind: "image" | "file";
  ext?: string;        // extension: "pdf", "png", ...
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  audioUrl?: string; // For TTS agent responses
};

function ChatView({
  onBack,
  selectedAgent,
  isCreator = false, // <- Креатор этого агента? Если да — без лимитов
}: {
  onBack: () => void;
  selectedAgent: Agent | null;
  isCreator?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: selectedAgent?.engineProvider === "tts"
        ? `🔊 Welcome to Voice Generator!\n\nI convert text to natural-sounding speech using AI. Just type or paste any text (up to 2000 characters) and I'll generate audio for you.\n\nTry it now — send me something to say!`
        : `Hi! ${
            selectedAgent ? `I'm ${selectedAgent.name}` : "I'm your agent"
          }. Ask me anything.`,
    },
  ]);

  const chatRef = useRef<HTMLDivElement | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  
  // Image viewer state
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [previewAttachmentIds, setPreviewAttachmentIds] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  // Cache for loaded attachment URLs (blob URLs from IndexedDB)
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const loadingAttachments = useRef<Set<string>>(new Set());

  // Pending files for upload (with temporary blob URLs for preview)
  type PendingFile = ChatAttachment & { tempUrl: string };
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 🔹 старт сессии / таймер
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  // ключ для localStorage по агенту
  const storageKey =
    selectedAgent && selectedAgent.id
      ? `echo_chat_${selectedAgent.id}`
      : null;

  // 🔹 Keyboard navigation for image preview modal
  useEffect(() => {
    if (!previewAttachmentId || previewAttachmentIds.length <= 1) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prevIdx = previewIndex > 0 ? previewIndex - 1 : previewAttachmentIds.length - 1;
        setPreviewIndex(prevIdx);
        setPreviewAttachmentId(previewAttachmentIds[prevIdx]);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const nextIdx = previewIndex < previewAttachmentIds.length - 1 ? previewIndex + 1 : 0;
        setPreviewIndex(nextIdx);
        setPreviewAttachmentId(previewAttachmentIds[nextIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPreviewAttachmentId(null);
        setPreviewAttachmentIds([]);
        setPreviewIndex(0);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [previewAttachmentId, previewAttachmentIds, previewIndex]);

  // 🔹 Load attachment blob from IndexedDB and create URL
  const loadAttachmentUrl = useCallback(async (attachmentId: string) => {
    // Already loaded or loading
    if (attachmentUrls[attachmentId] || loadingAttachments.current.has(attachmentId)) {
      return;
    }

    loadingAttachments.current.add(attachmentId);

    try {
      const blob = await getAttachmentBlob(attachmentId);
      if (blob) {
        const url = URL.createObjectURL(blob);
        setAttachmentUrls(prev => ({ ...prev, [attachmentId]: url }));
      }
    } catch (error) {
      console.error("Failed to load attachment:", attachmentId, error);
    } finally {
      loadingAttachments.current.delete(attachmentId);
    }
  }, [attachmentUrls]);

  // 🔹 Cleanup attachment URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(attachmentUrls).forEach(url => {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, []);

  // 🔹 подгружаем историю из localStorage при смене агента
  useEffect(() => {
    if (!selectedAgent) return;

    let initial: ChatMessage[] = [
      {
        role: "assistant",
        content: `Hi! I'm ${selectedAgent.name}. Ask me anything.`,
      },
    ];

    try {
      if (storageKey && typeof window !== "undefined") {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            initial = parsed;
          }
        }
      }
    } catch {
      // если что-то пошло не так — просто оставляем дефолтное приветствие
    }

    setMessages(initial);
    setSessionStart(Date.now());
    setElapsedSec(0);
    setPendingFiles([]); // при смене агента чистим незасланные файлы
  }, [selectedAgent?.id, storageKey, selectedAgent?.name]);

  // Cleanup object URLs when component unmounts or files are removed
  useEffect(() => {
    return () => {
      // Revoke all pending file URLs on cleanup
      pendingFiles.forEach((file) => {
        if (file.tempUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(file.tempUrl);
        }
      });
    };
  }, [pendingFiles]);

  // 🔹 тикающий таймер каждую секунду
  useEffect(() => {
    if (!sessionStart) return;
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - sessionStart) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [sessionStart]);

  // --- Auto-scroll to bottom when messages change ---
  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTo({
      top: chatRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 0) IME/composition (китайский/японский ввод) — не трогаем
      if ((e as any).isComposing) return;
  
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
  
      // 1) если уже печатают в input/textarea/contenteditable — не лезем
      const isTypingElement =
        tag === "input" ||
        tag === "textarea" ||
        (target && (target as any).isContentEditable);
  
      if (isTypingElement) return;
  
      // 2) модификаторы — не трогаем (Cmd/Ctrl/Alt)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
  
      // 3) не перехватываем Escape (пусть закрывает модалки и т.д.)
      if (e.key === "Escape") return;
  
      const el = inputRef.current;
      if (!el) return;
      if (el.disabled) return;
  
      // 4) всегда фокусим чат-инпут
      el.focus();
  
      // 5) печатаемые символы — добавляем (управляемый инпут)
      if (e.key.length === 1 && !e.repeat) {
        e.preventDefault();
  
        setInput((prev) => {
          const next = prev + e.key;
  
          // курсор в конец после обновления
          requestAnimationFrame(() => {
            const node = inputRef.current;
            if (!node) return;
            const len = next.length;
            try {
              node.setSelectionRange(len, len);
            } catch {}
          });
  
          return next;
        });
  
        return;
      }
  
      // 6) Backspace — тоже эмулируем, иначе “на любую кнопку” ощущается сломанным
      if (e.key === "Backspace" && !e.repeat) {
        e.preventDefault();
  
        setInput((prev) => {
          const next = prev.slice(0, -1);
  
          requestAnimationFrame(() => {
            const node = inputRef.current;
            if (!node) return;
            const len = next.length;
            try {
              node.setSelectionRange(len, len);
            } catch {}
          });
  
          return next;
        });
  
        return;
      }
  
      // 7) Остальные клавиши (Enter/Tab/стрелки/F1...) —
      // не предотвращаем дефолт, просто фокус уже поставили.
    };
  
    document.addEventListener("keydown", handler, { capture: true });
    return () => {
      document.removeEventListener("keydown", handler, { capture: true } as any);
    };
  }, []);
  
  

  
  // 🔹 helper — сохранить массив сообщений и в state, и в localStorage
  const syncMessages = (next: ChatMessage[]) => {
    setMessages(next);
    try {
      if (storageKey && typeof window !== "undefined") {
        localStorage.setItem(storageKey, JSON.stringify(next));
      }
    } catch {
      // молча игнорируем ошибки localStorage
    }
  };

  // 🔹 считаем лимиты
  const userMsgCount = messages.filter((m) => m.role === "user").length;
  const maxMsgs = selectedAgent?.maxMessagesPerSession ?? null;
  const maxMins = selectedAgent?.maxDurationMinutes ?? null;
  const maxSec = maxMins ? maxMins * 60 : null;

  const overMessages =
    maxMsgs !== null && maxMsgs !== undefined && userMsgCount >= maxMsgs;
  const overTime =
    maxSec !== null && maxSec !== undefined && elapsedSec >= maxSec;

  // ❗ ВАЖНО: если isCreator = true → лимиты не блокируют
  const sessionBlocked = !isCreator && (overMessages || overTime);

  function formatSeconds(total: number) {
    const s = Math.max(0, total);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec
      .toString()
      .padStart(2, "0")}`;
  }

  const timeLabel =
    maxSec != null
      ? formatSeconds(Math.max(0, maxSec - elapsedSec)) // время до конца
      : formatSeconds(elapsedSec); // сколько уже идёт

      function formatFileSize(bytes: number): string {
        if (!bytes) return "0 B";
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(1)} KB`;
        const mb = kb / 1024;
        return `${mb.toFixed(1)} MB`;
      }
    
      async function addFiles(files: File[]) {
        if (!files.length) return;
    
        const newPendingFiles: PendingFile[] = await Promise.all(files.map(async (file) => {
          let id: string;
          try {
            id = crypto.randomUUID();
          } catch {
            id = `${Date.now()}_${file.name}_${Math.random()}`;
          }
    
          const ext = file.name.includes(".")
            ? file.name.split(".").pop()!.toLowerCase()
            : "";
          
          const isHeic = ["heic", "heif"].includes(ext);
          let blobToStore: Blob = file;
          let finalMime = file.type || "application/octet-stream";
          let finalName = file.name;
          let finalExt = ext;
          
          // Convert HEIC/HEIF to JPEG
          if (isHeic) {
            try {
              const converted = await heic2any({
                blob: file,
                toType: "image/jpeg",
                quality: 0.92,
              }) as Blob | Blob[];
              blobToStore = Array.isArray(converted) ? converted[0] : converted;
              finalMime = "image/jpeg";
              finalName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
              finalExt = "jpg";
            } catch (error) {
              console.warn("HEIC conversion failed, treating as file:", error);
            }
          }
          
          // Check if file is an image (by mime type OR extension)
          const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "heic", "heif"];
          const isImage = finalMime.startsWith("image/") || imageExtensions.includes(finalExt);

          // Save blob to IndexedDB
          try {
            await putAttachment({
              id,
              blob: blobToStore,
              name: finalName,
              mime: finalMime,
              size: blobToStore.size,
            });
          } catch (error) {
            console.error("Failed to save attachment to IndexedDB:", error);
          }

          // Create temporary URL for preview (will be revoked after sending)
          const tempUrl = URL.createObjectURL(blobToStore);
    
          return {
            id,
            name: finalName,
            mime: finalMime,
            size: blobToStore.size,
            kind: isImage ? "image" : "file",
            ext: finalExt,
            tempUrl,
          } as PendingFile;
        }));
    
        setPendingFiles((prev) => [...prev, ...newPendingFiles]);
      }
    
      // 🔹 обработка выбора файлов через input
      async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        await addFiles(files);
        if (e.target) e.target.value = "";
      }
    
      // 🔹 drag-and-drop
      function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setIsDragging(true);
      }
    
      function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setIsDragging(false);
      }
    
      async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (!files.length) return;
        await addFiles(files);
      }
    

  // 🔹 отправка сообщения (текст + файлы)
  async function send() {
    const text = input.trim();

    // если нет ни текста, ни файлов — ничего не делаем
    if (!text && pendingFiles.length === 0) return;
    if (!selectedAgent) return;

    // 🔒 если лимит сессии достигнут и это не креатор — блокируем отправку
    if (sessionBlocked) {
      const next: ChatMessage[] = [
        ...messages,
        {
          role: "assistant",
          content:
            "Session limit reached for this agent (messages/time). Buy a new session to continue.",
        },
      ];
      syncMessages(next);
      return;
    }

    // Convert PendingFiles to ChatAttachments (strip tempUrl)
    const attachments: ChatAttachment[] = pendingFiles.map(pf => ({
      id: pf.id,
      name: pf.name,
      mime: pf.mime,
      size: pf.size,
      kind: pf.kind,
      ext: pf.ext,
    }));

    const userMsg: ChatMessage = {
      role: "user",
      content: text || (pendingFiles.length ? "" : ""),
      ...(attachments.length ? { attachments } : {}),
    };

    const history = [...messages, userMsg];

    // Revoke temporary URLs and clear pending files
    pendingFiles.forEach(pf => {
      if (pf.tempUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(pf.tempUrl);
      }
    });

    setInput("");
    setPendingFiles([]);

    if (inputRef.current) {
      inputRef.current.focus();
    }

    syncMessages(history);
    setLoading(true);

    try {
      // 🔊 TTS Agent - Convert text to speech
      if (selectedAgent.engineProvider === "tts") {
        if (!text) {
          const next: ChatMessage[] = [
            ...history,
            {
              role: "assistant",
              content: "Please enter some text that you'd like me to convert to speech.",
            },
          ];
          syncMessages(next);
          setLoading(false);
          return;
        }

        try {
          const ttsResponse = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.slice(0, 2000) }),
          });

          if (!ttsResponse.ok) {
            const errorData = await ttsResponse.json().catch(() => ({}));
            throw new Error(errorData?.error?.message || `TTS failed: ${ttsResponse.status}`);
          }

          const audioBlob = await ttsResponse.blob();
          const audioUrl = URL.createObjectURL(audioBlob);

          const next: ChatMessage[] = [
            ...history,
            {
              role: "assistant",
              content: `🔊 Here's your audio for:\n\n"${text.length > 100 ? text.slice(0, 100) + '...' : text}"`,
              audioUrl,
            },
          ];
          syncMessages(next);

          // Auto-play the audio
          const audio = new Audio(audioUrl);
          audio.play().catch(() => {
            // Autoplay blocked, user will use the player
          });

        } catch (ttsError: any) {
          console.error("TTS Error:", ttsError);
          const next: ChatMessage[] = [
            ...history,
            {
              role: "assistant",
              content: `Sorry, I couldn't generate the audio. ${ttsError?.message || "Please try again."}`,
            },
          ];
          syncMessages(next);
        }

        setLoading(false);
        return;
      }

      // Messages for backend — only role + content + attachment metadata
      const backendMessages = history.map((m) => ({
        role: m.role,
        content: m.content || "",
        attachments: (m.attachments || []).map((a) => ({
          name: a.name,
          kind: a.kind,
          ext: a.ext,
          mime: a.mime,
        })),
      }));
      

      // 🔹 режим кастомного backend создателя
      if (
        selectedAgent.engineProvider === "creator_backend" &&
        selectedAgent.engineApiUrl
      ) {
        console.log("➡️ creator_backend call", {
          url: selectedAgent.engineApiUrl,
          agentId: selectedAgent.id,
          hasToken: !!selectedAgent.authToken,
        });
        
        const res = await fetch("/api/agent-backend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: selectedAgent.id,
            messages: backendMessages,
          }),
        });
        
        
        
        

        if (!res.ok) {
  const errText = await res.text().catch(() => "");
  console.error("Creator backend error:", res.status, errText);

  // покажем ошибку прямо в чате, чтобы не лезть в консоль каждый раз
  const next: ChatMessage[] = [
    ...history,
    {
      role: "assistant",
      content:
        `Backend error ${res.status}:\n` +
        (errText ? errText.slice(0, 600) : "(no body)"),
    },
  ];
  syncMessages(next);
  setLoading(false);
  return;
}

        let replyText = "";
        const contentType = res.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const data = await res.json();
          replyText =
            data?.reply ||
            data?.content ||
            data?.message ||
            "[Creator backend did not return reply]";
        } else {
          const raw = await res.text();
          replyText =
            "Backend responded (non-JSON). Raw preview:\n\n" +
            raw.slice(0, 300);
        }

        const next: ChatMessage[] = [
          ...history,
          { role: "assistant", content: replyText },
        ];
        syncMessages(next);
      } else {
        // 🔹 дефолтный echo-режим
        await new Promise((r) => setTimeout(r, 200));
        const next: ChatMessage[] = [
          ...history,
          {
            role: "assistant",
            content: `LOCAL ECHO (backend NOT used): ${text || "(attachments sent)"}`
          },
        ];
        syncMessages(next);
      }
    } catch (e) {
      console.error(e);
      const next: ChatMessage[] = [
        ...history,
        {
          role: "assistant",
          content:
            "There was an error calling this agent's backend. Please check the configuration.",
        },
      ];
      syncMessages(next);
    } finally {
      setLoading(false);
    }
  }

  // навигация на страницу агента, чтобы купить новую сессию
  function goBuyNewSession() {
    if (!selectedAgent) return;

    // сессия закончилась по лимитам → очищаем её,
    // чтобы можно было купить новую
    clearSession(selectedAgent.id);

    if (typeof window !== "undefined") {
      window.location.hash = `/agent?id=${encodeURIComponent(
        selectedAgent.id
      )}`;
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-b from-black via-[#050513] to-black text-white flex flex-col">
      {/* HEADER */}
      <header className="shrink-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="bg-white/10 hover:bg-white/20"
              onClick={onBack}
            >
              ← Back
            </Button>

            {selectedAgent ? (
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-white/10 grid place-items-center text-lg">
                  {selectedAgent.avatar}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {selectedAgent.name}
                  </span>
                  <span className="text-[11px] text-white/50 line-clamp-1">
                    {selectedAgent.tagline}
                  </span>
                </div>
              </div>
            ) : (
              <div className="font-semibold">Chat</div>
            )}
          </div>

          {/* 🔹 Таймер + счётчик запросов справа */}
          {selectedAgent && (
            <div className="flex flex-col items-end gap-1 text-xs">
              <div className="inline-flex items-center gap-1 rounded-full px-2 py-1 bg-white/5 border border-white/10">
                <span className="text-white/50">
                  {maxSec != null ? "Time left" : "Time"}
                </span>
                <span
                  className={cx(
                    "font-mono",
                    !isCreator && (sessionBlocked || overTime)
                      ? "text-red-400"
                      : "text-emerald-300"
                  )}
                >
                  {timeLabel}
                </span>
              </div>
              {maxMsgs != null && (
                <div className="inline-flex items-center gap-1 rounded-full px-2 py-1 bg-white/5 border border-white/10">
                  <span className="text-white/50">Messages</span>
                  <span
                    className={cx(
                      "font-mono",
                      !isCreator && (sessionBlocked || overMessages)
                        ? "text-red-400"
                        : "text-emerald-300"
                    )}
                  >
                    {userMsgCount}/{maxMsgs}
                  </span>
                </div>
              )}
            </div>
          )}
          
        </div>
      </header>

      {/* BODY - Fixed height flex container */}
      <div className="flex-1 min-h-0 max-w-5xl mx-auto w-full px-4 py-3 flex flex-col gap-3">
                {/* Chat container + drag-and-drop */}
                <div
          ref={chatRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cx(
            "flex-1 min-h-0 overflow-auto rounded-2xl bg-gradient-to-b from-white/[0.04] via-white/[0.02] to-transparent p-4 border transition-colors",
            isDragging ? "border-cyan-400/70 bg-cyan-500/5" : "border-white/10"
          )}
        >

          {/* если сессия закончена — баннер + кнопка купить */}
          {sessionBlocked && (
            <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>
                Session limit reached for this agent. Buy a new session to
                continue the conversation.
              </span>
              <Button
                variant="secondary"
                className="bg-amber-400/20 hover:bg-amber-400/30 text-amber-50 text-xs px-3 py-1"
                onClick={goBuyNewSession}
              >
                Buy new session
              </Button>
            </div>
          )}

          {messages.map((m, i) => {
            const isUser = m.role === "user";
            
            // Check if message is image-only (no text, only image attachments)
            const images = m.attachments?.filter(att => att.kind === "image") || [];
            const files = m.attachments?.filter(att => att.kind === "file") || [];
            const hasText = m.content && m.content.trim().length > 0;
            const isImageOnlyMessage = !hasText && images.length > 0 && files.length === 0;

            // Helper to render an image attachment
            const renderImageAttachment = (att: ChatAttachment, maxW: string, maxH: string, rounded: string) => {
              const url = attachmentUrls[att.id];
              
              // Trigger lazy load if not loaded
              if (!url) {
                loadAttachmentUrl(att.id);
              }

              return (
                <div 
                  key={att.id}
                  className={`${maxW} ${maxH} ${rounded} overflow-hidden bg-white/5 cursor-pointer hover:opacity-90 transition border border-white/10`}
                  onClick={() => {
                    const imageIds = images.map(img => img.id);
                    setPreviewAttachmentIds(imageIds);
                    setPreviewIndex(imageIds.indexOf(att.id));
                    setPreviewAttachmentId(att.id);
                  }}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={att.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        console.warn("Image failed to load:", att.name);
                        const target = e.target as HTMLImageElement;
                        target.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">
                      Loading...
                    </div>
                  )}
                </div>
              );
            };
            
            // For image-only messages, render without the bubble frame
            if (isImageOnlyMessage) {
              return (
                <div
                  key={i}
                  className={cx(
                    "mb-2 flex w-full",
                    isUser ? "justify-end" : "justify-start"
                  )}
                >
                  <div className="flex flex-col gap-1.5">
                    {images.map((att) => renderImageAttachment(att, "max-w-[280px]", "max-h-[200px]", "rounded-xl"))}
                  </div>
                </div>
              );
            }
            
            // Regular message with text (and optional attachments)
            return (
              <div
                key={i}
                className={cx(
                  "mb-2 flex w-full",
                  isUser ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cx(
                    "max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                    isUser
                      ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-br-sm"
                      : "bg-white/8 border border-white/10 text-white rounded-bl-sm"
                  )}
                >
                  {/* текст сообщения */}
                  {hasText && <div>{m.content}</div>}

                  {/* 🔊 Audio player for TTS agent responses */}
                  {m.audioUrl && (
                    <div className="mt-3 p-3 rounded-xl bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border border-indigo-500/30">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">🔊</span>
                        <span className="text-xs text-white/60">Generated Audio</span>
                      </div>
                      <audio 
                        controls 
                        src={m.audioUrl} 
                        className="w-full h-10 rounded-lg"
                        style={{ 
                          filter: "invert(1) hue-rotate(180deg)",
                          opacity: 0.9 
                        }}
                      />
                      <div className="mt-2 flex gap-2">
                        <a
                          href={m.audioUrl}
                          download={`tts-audio-${Date.now()}.mp3`}
                          className="text-[11px] text-indigo-300 hover:text-indigo-200 underline transition"
                        >
                          Download MP3
                        </a>
                      </div>
                    </div>
                  )}

                  {/* вложения (images + files) inside bubble for mixed content */}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className={hasText ? "mt-2" : ""}>
                      {/* Images - vertical stack */}
                      {images.length > 0 && (
                        <div className="flex flex-col gap-1.5 mb-2">
                          {images.map((att) => renderImageAttachment(att, "max-w-[260px]", "max-h-[180px]", "rounded-lg"))}
                        </div>
                      )}
                            
                      {/* File cards */}
                      {files.length > 0 && (
                        <div className="space-y-2">
                          {files.map((att) => {
                            const fileUrl = attachmentUrls[att.id];
                            if (!fileUrl) {
                              loadAttachmentUrl(att.id);
                            }
                            const sizeLabel = att.size ? (att.size < 1024 * 1024 
                              ? `${(att.size / 1024).toFixed(1)} KB` 
                              : `${(att.size / 1024 / 1024).toFixed(1)} MB`) : "";
                            
                            return (
                              <div
                                key={att.id}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/15 bg-black/20 text-xs cursor-pointer hover:bg-white/10 transition"
                                onClick={() => {
                                  if (fileUrl) {
                                    window.open(fileUrl, "_blank");
                                  }
                                }}
                              >
                                <div className="h-8 w-8 rounded-md bg-white/10 flex items-center justify-center font-mono text-[10px] uppercase">
                                  {att.ext || "FILE"}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="truncate">{att.name}</div>
                                  <div className="text-[10px] text-white/50">
                                    {(att.ext || "file").toUpperCase()}
                                    {sizeLabel ? ` · ${sizeLabel}` : ""}
                                  </div>
                                </div>
                                {fileUrl && (
                                  <a
                                    href={fileUrl}
                                    download={att.name}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs underline text-white/60 hover:text-white/80 transition"
                                  >
                                    Open
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* индикатор "печатает" */}
          {loading && (
            <div className="flex justify-start mt-1">
              <div className="inline-flex items-center gap-1 rounded-2xl bg-white/10 border border-white/10 px-3 py-1 text-xs text-white/60">
                <span className="h-1.5 w-1.5 rounded-full bg-white/60 animate-pulse" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/30 animate-pulse [animation-delay:300ms]" />
                <span className="ml-1">Agent is thinking…</span>
              </div>
            </div>
          )}
        </div>

        {/* Input row + attachments - Fixed at bottom, doesn't expand page */}
        <div className="shrink-0 flex flex-col gap-2">
          {/* превью выбранных файлов до отправки - with max height and scroll */}
          {pendingFiles.length > 0 && (
            <div className="max-h-28 overflow-y-auto overflow-x-hidden">
              <div className="flex items-center gap-3 pb-1">
                {pendingFiles.map((att) => {
                  // Revoke URL and remove from IndexedDB when removing file
                  const handleRemove = async () => {
                    if (att.tempUrl?.startsWith("blob:")) {
                      URL.revokeObjectURL(att.tempUrl);
                    }
                    // Also remove from IndexedDB
                    try {
                      await deleteAttachments([att.id]);
                    } catch (e) {
                      console.warn("Failed to delete attachment from IndexedDB:", e);
                    }
                    setPendingFiles((prev) =>
                      prev.filter((f) => f.id !== att.id)
                    );
                  };

                  const sizeLabel = att.size ? (att.size < 1024 * 1024 
                    ? `${(att.size / 1024).toFixed(1)} KB` 
                    : `${(att.size / 1024 / 1024).toFixed(1)} MB`) : "";

                  return (
                    <div
                      key={att.id}
                      className="relative shrink-0 flex items-center"
                    >
                      {att.kind === "image" ? (
                        // 🖼 image preview
                        <img
                          src={att.tempUrl}
                          alt={att.name}
                          className="h-24 w-24 rounded-lg object-cover border border-white/10 shadow-md"
                          onError={(e) => {
                            console.warn("Image failed to load, showing as file:", att.name);
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        // 📎 file card
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/15 bg-white/5 text-xs min-w-[190px] max-w-[260px]">
                          <div className="h-8 w-8 rounded-md bg-white/10 flex items-center justify-center font-mono text-[10px] uppercase">
                            {att.ext || "FILE"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{att.name}</div>
                            <div className="text-[10px] text-white/50">
                              {(att.ext || "file").toUpperCase()}
                              {sizeLabel ? ` · ${sizeLabel}` : ""}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* remove button */}
                      <button
                        onClick={handleRemove}
                        className="absolute -top-2 -right-2 bg-black/80 text-white text-xs h-5 w-5 rounded-full flex items-center justify-center border border-white/30 hover:bg-black/90 transition"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}

                {/* clear all button */}
                <button
                  type="button"
                  className="text-xs text-white/50 underline hover:text-white/70 transition"
                  onClick={async () => {
                    // Revoke all URLs and delete from IndexedDB
                    const ids = pendingFiles.map(f => f.id);
                    pendingFiles.forEach((file) => {
                      if (file.tempUrl?.startsWith("blob:")) {
                        URL.revokeObjectURL(file.tempUrl);
                      }
                    });
                    try {
                      await deleteAttachments(ids);
                    } catch (e) {
                      console.warn("Failed to delete attachments from IndexedDB:", e);
                    }
                    setPendingFiles([]);
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>
          )}


          <div className="flex gap-2">
            {/* кнопка прикрепить */}
            <Button
              variant="secondary"
              className="px-3"
              onClick={() => fileInputRef.current?.click()}
              disabled={(!isCreator && sessionBlocked) || loading || !selectedAgent}
            >
              <Paperclip className="h-4 w-4" />
            </Button>

            <Input
  ref={inputRef}
  placeholder={
    sessionBlocked && !isCreator
      ? "Session limit reached for this agent"
      : "Type your message…"
  }
  value={input}
  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
    setInput(e.target.value)
  }
  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") send();
  }}
  className="bg-white/5 border-white/10 flex-1"
  disabled={(!isCreator && sessionBlocked) || loading}
/>


            <Button
              onClick={() => send()}
              disabled={
                loading ||
                (!isCreator && sessionBlocked) ||
                !selectedAgent ||
                (!input.trim() && pendingFiles.length === 0)
              }
              className="min-w-[96px]"
            >
              {!isCreator && sessionBlocked
                ? "Session ended"
                : loading
                ? "Sending…"
                : "Send"}
            </Button>
          </div>

          {/* скрытый input для файлов */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,application/pdf,.txt,.doc,.docx"
            onChange={handleFilesSelected}
          />
        </div>

        <div className="text-[11px] text-white/50">
          Session limits (time & messages) are enforced locally for
          regular users. Creators can use their own agents without limits.  
          Your conversation is stored per-agent in your browser.  
          File uploads are handled in the browser for preview.
        </div>
      </div>
       {/* Image Lightbox/Viewer Modal */}
       {previewAttachmentId && (() => {
          const previewUrl = attachmentUrls[previewAttachmentId];
          
          // Ensure the attachment is loaded
          if (!previewUrl) {
            loadAttachmentUrl(previewAttachmentId);
          }

          const closeViewer = () => {
            setPreviewAttachmentId(null);
            setPreviewAttachmentIds([]);
            setPreviewIndex(0);
          };

          const goToPrev = (e: React.MouseEvent) => {
            e.stopPropagation();
            const prevIdx = previewIndex > 0 ? previewIndex - 1 : previewAttachmentIds.length - 1;
            setPreviewIndex(prevIdx);
            setPreviewAttachmentId(previewAttachmentIds[prevIdx]);
          };

          const goToNext = (e: React.MouseEvent) => {
            e.stopPropagation();
            const nextIdx = previewIndex < previewAttachmentIds.length - 1 ? previewIndex + 1 : 0;
            setPreviewIndex(nextIdx);
            setPreviewAttachmentId(previewAttachmentIds[nextIdx]);
          };

          return (
            <div
              className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
              onClick={closeViewer}
            >
              {/* Close button */}
              <button
                onClick={closeViewer}
                className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-2xl transition z-20"
              >
                ×
              </button>

              {/* Navigation - Previous */}
              {previewAttachmentIds.length > 1 && (
                <button
                  onClick={goToPrev}
                  className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-2xl transition z-20"
                >
                  ‹
                </button>
              )}

              {/* Navigation - Next */}
              {previewAttachmentIds.length > 1 && (
                <button
                  onClick={goToNext}
                  className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-2xl transition z-20"
                >
                  ›
                </button>
              )}

              {/* Main Image */}
              <div
                className="flex flex-col items-center justify-center p-4"
                onClick={(e) => e.stopPropagation()}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
                    onError={(e) => {
                      console.error("Preview image failed to load");
                      const target = e.target as HTMLImageElement;
                      target.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-4 p-8 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-white/40 text-lg">Loading image...</div>
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  </div>
                )}

                {/* Image counter */}
                {previewAttachmentIds.length > 1 && (
                  <div className="mt-4 text-xs text-white/50">
                    {previewIndex + 1} / {previewAttachmentIds.length}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}



function LearnPage({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const tab = params.get("tab");

    if (tab === "hosted-prompt") {
      // небольшая задержка, чтобы DOM точно успел отрендериться
      setTimeout(() => {
        document.getElementById("hosted-prompt")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 50);
    }
  }, []);

  return (
    <div className="min-h-screen w-screen bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
      
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="bg-white/10 hover:bg-white/20"
              onClick={onBack}
            >
              ← Back
            </Button>
            <div className="font-semibold text-lg">Learn</div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-10 text-white/80">

        <h1 className="text-3xl font-semibold">Creating Agents on Echo</h1>

        <section className="space-y-2">
          <h2 className="text-xl font-medium">1. Hosted on Echo</h2>
          <p className="text-sm text-white/60">
            No backend. No servers. Just add your persona, prompt, and price — we host and run the model for you.
          </p>
        </section>
{/* ================= PROMPT GUIDE (HOSTED) ================= */}
<section
  id="hosted-prompt"
  className="space-y-3 border border-white/10 rounded-xl p-5 bg-white/[0.03]"
>
  <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
    Hosted on da GOAT • Prompt guide
  </div>

  <h2 className="text-xl font-medium text-white">
    How to write a great prompt (so your agent feels consistent)
  </h2>

  <p className="text-sm text-white/60 leading-relaxed">
    In Hosted mode, your agent is driven by this text. The clearer the rules and
    format, the more stable the answers. Use the template below.
  </p>

  <div className="grid md:grid-cols-2 gap-4">
    {/* Left: steps */}
    <div className="space-y-3 text-sm text-white/70">
      <div className="space-y-1">
        <div className="font-medium text-white/85">1) Role + purpose (1–2 lines)</div>
        <div className="text-white/60">Who the agent is and what it helps with.</div>
      </div>

      <div className="space-y-1">
        <div className="font-medium text-white/85">2) Audience</div>
        <div className="text-white/60">Newbie / intermediate / expert.</div>
      </div>

      <div className="space-y-1">
        <div className="font-medium text-white/85">3) Rules (3–10 bullets)</div>
        <div className="text-white/60">
          Example rules: ask clarifying questions, don’t hallucinate, don’t give financial advice, keep answers short.
        </div>
      </div>

      <div className="space-y-1">
        <div className="font-medium text-white/85">4) Output format</div>
        <div className="text-white/60">Force a consistent structure (TL;DR → details → next steps).</div>
      </div>

      <div className="space-y-1">
        <div className="font-medium text-white/85">5) Examples (optional, but powerful)</div>
        <div className="text-white/60">2–3 “User → Ideal answer” examples.</div>
      </div>
    </div>

    {/* Right: template */}
    <div className="space-y-2">
      <div className="text-xs text-white/60">Copy-paste template:</div>

      <pre className="text-xs whitespace-pre-wrap bg-black/40 border border-white/10 rounded-lg p-3 text-white/80">
{`ROLE:
You are a [role]. Your job is to [purpose].

AUDIENCE:
Explain for [newbie/intermediate/expert]. Tone: [friendly/serious].

RULES:
- If info is missing, ask 1–3 clarifying questions.
- If unsure, say you’re unsure and explain what you’d need to know.
- Avoid financial advice. Provide educational info only.
- Keep answers concise and structured.

OUTPUT FORMAT:
1) TL;DR (1–2 lines)
2) Key points (bullets)
3) Risks / caveats (if relevant)
4) Next step / question to user

EXAMPLES:
User: ...
Assistant: ...
`}
      </pre>

      <button
        type="button"
        onClick={() => {
          const text = `ROLE:
You are a [role]. Your job is to [purpose].

AUDIENCE:
Explain for [newbie/intermediate/expert]. Tone: [friendly/serious].

RULES:
- If info is missing, ask 1–3 clarifying questions.
- If unsure, say you’re unsure and explain what you’d need to know.
- Avoid financial advice. Provide educational info only.
- Keep answers concise and structured.

OUTPUT FORMAT:
1) TL;DR (1–2 lines)
2) Key points (bullets)
3) Risks / caveats (if relevant)
4) Next step / question to user

EXAMPLES:
User: ...
Assistant: ...
`;
          navigator.clipboard?.writeText(text);
        }}
        className="text-xs px-3 py-2 rounded-lg bg-white/10 border border-white/15 hover:bg-white/15 transition"
      >
        Copy template
      </button>
    </div>
  </div>
</section>

        <section className="space-y-2">
          <h2 className="text-xl font-medium">2. Use My Backend</h2>
          <p className="text-sm text-white/60">
            Echo forwards every user message to your API endpoint. Your backend returns the reply. 
            You can use OpenAI, Google Gemini, Anthropic, your own APIs, databases, trading engines — anything.
          </p>

          <pre className="bg-black/40 border border-white/10 rounded-md p-3 text-xs whitespace-pre-wrap">
{`POST /your-endpoint
x-echo-key: <your-token>

{
  "agentId": "...",
  "messages": [...],
  "meta": { ... }
}`}
          </pre>

          <p className="text-sm text-white/60">Your backend must return:</p>

          <pre className="bg-black/40 border border-white/10 rounded-md p-3 text-xs whitespace-pre-wrap">
{`{ "reply": "your response" }`}
          </pre>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-medium">3. RAG / Knowledge Base</h2>
          <p className="text-sm text-white/60">
            Connect your own document search or vector database. Echo passes metadata so your backend 
            can retrieve relevant documents for grounded answers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-medium">4. Tools</h2>
          <p className="text-sm text-white/60">
            Declare what external capabilities your agent uses (e.g. pricing API, CRM, trading engine). 
            This is informational for users and helps with transparency.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-medium">5. Auth Token</h2>
          <p className="text-sm text-white/60">
            Your backend can validate requests using x-echo-key. 
            Never put OpenAI or Google API keys inside Echo — keep them on your backend only.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-medium">Payments & Sessions</h2>
          <p className="text-sm text-white/60">
            Users pay in USDC via Phantom. After payment, they unlock a session with time and message limits.
          </p>
        </section>

        <section className="space-y-2 pb-20">
          <h2 className="text-xl font-medium">Deploying a Backend</h2>
          <p className="text-sm text-white/60">You can deploy your backend on:</p>
          <ul className="list-disc list-inside text-sm text-white/60 space-y-1">
            <li>Google Cloud Run / Cloud Functions</li>
            <li>Vercel serverless functions</li>
            <li>AWS Lambda</li>
            <li>Railway / Render</li>
            <li>Your own VPS</li>
          </ul>
        </section>

      </div>
    </div>
  );
}



// --- Profile Views ---
function ProfileAgentsView({
  onBack,
  agents,
  address,
  onOpenAgent,
  onEditAgent,
}: {
  onBack: () => void;
  agents: Agent[];
  address: string | null;
  onOpenAgent: (id: string) => void;
  onEditAgent: (agent: Agent) => void;
}) {
  const mine = agents.filter(a => a.creator && a.creator === (address || ''));

  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
      <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="bg-white/10 hover:bg-white/20"
              onClick={onBack}
            >
              ← Back
            </Button>
            <div className="font-semibold">My Agents</div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {address && (
          <div className="text-xs text-white/50">
            Connected wallet: <span className="font-mono">{address}</span>
          </div>
        )}

        {mine.length === 0 ? (
          <div className="text-white/60">
            You haven't created any agents yet. Click “Create Agent” on the
            home page to publish your first one.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {mine.map(a => {
              const engineLabel =
                a.engineProvider === "creator_backend"
                  ? "Custom backend"
                  : "Echo engine";

              const backendShort =
                a.engineProvider === "creator_backend" && a.engineApiUrl
                  ? a.engineApiUrl.length > 40
                    ? a.engineApiUrl.slice(0, 40) + "..."
                    : a.engineApiUrl
                  : null;

              return (
                <Card key={a.id} className="bg-white/[.04] flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-base">{a.name}</CardTitle>
                    <CardDescription>{a.tagline}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm text-white/70">
                      {a.sessions.toLocaleString()} sessions •{" "}
                      {a.likes.toLocaleString()} likes
                    </div>
                    <div className="text-xs text-white/60">
                      Price:{" "}
                      <span className="font-medium">
                        {formatUSDC(a.priceUSDC)}
                      </span>
                    </div>
                    <div className="text-xs text-white/60">
                      Engine: <span className="font-medium">{engineLabel}</span>
                    </div>
                    {backendShort && (
                      <div className="text-[11px] text-white/50 break-all">
                        API: {backendShort}
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-white/50 truncate">
                      ID: <span className="font-mono">{a.id}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        className="bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
                        onClick={() => onOpenAgent(a.id)}
                      >
                        Open
                      </Button>
                      <Button
                        className="text-xs px-3 py-1"
                        onClick={() => onEditAgent(a)}
                      >
                        Edit
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileSavedView({
  onBack,
  agents,
  saved,
  onOpenAgent,
  onOpenPay,
}: {
  onBack: () => void;
  agents: Agent[];
  saved: Record<string, boolean>;
  onOpenAgent: (id: string) => void;
  onOpenPay: (agent: Agent) => void;
}) {
  const favorites = agents.filter((a) => saved[a.id]);

  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
      <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="bg-white/10 hover:bg-white/20"
              onClick={onBack}
            >
              ← Back
            </Button>
            <div className="font-semibold">Saved Agents</div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {favorites.length === 0 ? (
          <div className="text-white/60 text-sm">
            You haven't saved any agents yet. Click “Save” on an agent card
            to add it here.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {favorites.map((a) => (
              <Card key={a.id} className="bg-white/[.04] flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    {a.avatar} {a.name}
                  </CardTitle>
                  <CardDescription>{a.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-white/70">
                  <div>
                    {a.likes.toLocaleString()} likes •{" "}
                    {a.sessions.toLocaleString()} sessions
                  </div>
                  <div className="text-xs text-white/60">
                    Price: <span className="font-medium">{formatUSDC(a.priceUSDC)}</span>
                  </div>
                </CardContent>
                <CardFooter className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-white/50 truncate">
                    ID: <span className="font-mono">{a.id}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
                      onClick={() => onOpenAgent(a.id)}
                    >
                      Open
                    </Button>
                    <Button
                      className="text-xs px-3 py-1"
                      onClick={() => onOpenPay(a)}
                    >
                      Chat
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function ProfilePurchasesView({ onBack, agents, purchases }: { onBack: () => void; agents: Agent[]; purchases: { id: string; agentId: string; priceUSDC: number; ts: number }[]; }) {
  const rows = purchases.map(p => ({ ...p, agent: agents.find(a => a.id === p.agentId) }));
  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
      <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="secondary" className="bg-white/10 hover:bg-white/20" onClick={onBack}>← Back</Button>
            <div className="font-semibold">Purchases</div>
          </div>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {rows.length === 0 ? (
          <div className="text-white/60">No purchases yet.</div>
        ) : (
          <div className="space-y-3">
            {rows.map(r => (
              <Card key={r.id} className="bg-white/[.04]">
                <CardContent className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{r.agent?.name || 'Unknown Agent'}</div>
                    <div className="text-xs text-white/60">{new Date(r.ts).toLocaleString()}</div>
                  </div>
                  <div className="text-sm font-semibold">{formatUSDC(r.priceUSDC)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ================= ABOUT PAGE =================
function AboutPage({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  return (
    <div className="min-h-screen w-screen bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
      
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="bg-white/10 hover:bg-white/20"
              onClick={onBack}
            >
              ← Back
            </Button>
            <div className="font-semibold text-lg">About</div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 via-purple-600/10 to-transparent" />
        <div className="max-w-4xl mx-auto px-4 py-16 relative">
          <h1 className="text-4xl md:text-5xl font-bold mb-6 bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
            About Echo
          </h1>
          <p className="text-xl md:text-2xl text-white/70 leading-relaxed max-w-3xl">
            Echo is a Web3-native marketplace for AI agents, built on Solana.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 pb-20 space-y-16">

        {/* Mission */}
        <section className="space-y-6">
          <p className="text-lg text-white/80 leading-relaxed">
            We enable creators to publish, monetize, and scale AI agents — and users to access specialized intelligence on demand. From crypto research and startup strategy to design, development, and everyday problem-solving, Echo connects people with the right AI agent for the job.
          </p>
          <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-600/10 to-purple-600/10 border border-white/10">
            <p className="text-lg text-white/90 italic">
              Our platform is designed around a simple idea:<br />
              <span className="text-white font-medium">AI should be composable, creator-owned, and paid for transparently.</span>
            </p>
          </div>
        </section>

        {/* What We Do */}
        <section className="space-y-6">
          <h2 className="text-2xl md:text-3xl font-semibold text-white">What We Do</h2>
          <p className="text-white/70">Echo allows anyone to:</p>
          <div className="grid gap-4">
            {[
              { icon: "🤖", title: "Create & Publish", desc: "Build AI agents with custom behavior, expertise, and pricing" },
              { icon: "💰", title: "Earn Per Session", desc: "Get paid directly wallet-to-wallet in USDC" },
              { icon: "🔍", title: "Discover & Use", desc: "Access specialized agents without subscriptions or lock-in" },
              { icon: "💬", title: "Interact in Real Time", desc: "Chat, share files, and enjoy session-based access" },
            ].map((item, i) => (
              <div key={i} className="flex gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/8 hover:border-white/15 transition">
                <div className="text-2xl">{item.icon}</div>
                <div>
                  <div className="font-medium text-white">{item.title}</div>
                  <div className="text-sm text-white/60">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-white/60 text-sm pt-2">
            Each agent on Echo is an independent digital product — owned by its creator, used by the community.
          </p>
        </section>

        {/* Why Echo */}
        <section className="space-y-6">
          <h2 className="text-2xl md:text-3xl font-semibold text-white">Why Echo</h2>
          <p className="text-white/70">We believe the future of AI is:</p>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { label: "Specialized", contrast: "not generic" },
              { label: "Open", contrast: "not platform-locked" },
              { label: "Creator-driven", contrast: "not centrally controlled" },
            ].map((item, i) => (
              <div key={i} className="p-5 rounded-xl bg-gradient-to-br from-white/[0.05] to-transparent border border-white/10 text-center">
                <div className="text-lg font-semibold text-white">{item.label}</div>
                <div className="text-sm text-white/40">{item.contrast}</div>
              </div>
            ))}
          </div>
          <p className="text-white/70 leading-relaxed">
            Echo removes intermediaries between creators and users, replacing opaque SaaS models with transparent, on-chain payments and usage-based access.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            {["No subscriptions", "No hidden fees", "Just value exchanged per session"].map((tag, i) => (
              <span key={i} className="px-4 py-2 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-sm text-indigo-300 font-medium">
                {tag}
              </span>
            ))}
          </div>
        </section>

        {/* Built for Web3 */}
        <section className="space-y-6">
          <h2 className="text-2xl md:text-3xl font-semibold text-white">Built for Web3</h2>
          <p className="text-white/70">Echo is built on Solana to ensure:</p>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { icon: "⚡", label: "Fast & Low-Cost", desc: "Lightning-fast transactions" },
              { icon: "💵", label: "USDC Payments", desc: "Seamless stablecoin payments" },
              { icon: "🌍", label: "Permissionless", desc: "Global access for everyone" },
            ].map((item, i) => (
              <div key={i} className="p-5 rounded-xl bg-white/[0.03] border border-white/8">
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="font-medium text-white">{item.label}</div>
                <div className="text-sm text-white/50">{item.desc}</div>
              </div>
            ))}
          </div>
          <p className="text-white/60 text-sm">
            Our architecture is designed to evolve alongside the AI ecosystem, enabling new agent types, monetization models, and on-chain integrations over time.
          </p>
        </section>

        {/* Vision */}
        <section className="space-y-6">
          <h2 className="text-2xl md:text-3xl font-semibold text-white">Our Vision</h2>
          <div className="p-8 rounded-2xl bg-gradient-to-br from-indigo-600/15 via-purple-600/10 to-transparent border border-white/10">
            <p className="text-xl text-white/90 leading-relaxed mb-6">
              We see Echo as the foundation for an <span className="text-white font-semibold">open AI economy</span> — where intelligence is modular, ownership is clear, and creators are rewarded fairly.
            </p>
            <div className="flex flex-col gap-2 text-white/70">
              <p>Echo is not just a marketplace.</p>
              <p className="text-lg text-white font-medium">It's an ecosystem for the next generation of AI agents.</p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center pt-8">
          <Button
            onClick={onBack}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-8 py-3 text-lg"
          >
            Explore Agents →
          </Button>
        </section>

      </div>
    </div>
  );
}

// ================= DOCUMENTATION PAGE =================
function DocsPage({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  // Section component for consistent styling
  const Section = ({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) => (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-xl md:text-2xl font-semibold text-white mb-4 pb-2 border-b border-white/10">{title}</h2>
      <div className="space-y-4 text-white/70">{children}</div>
    </section>
  );

  const SubSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-3">
      <h3 className="text-lg font-medium text-white/90">{title}</h3>
      <div className="space-y-2 text-white/60">{children}</div>
    </div>
  );

  const BulletList = ({ items }: { items: string[] }) => (
    <ul className="space-y-1.5 ml-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="text-indigo-400">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );

  const InfoCard = ({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "highlight" }) => (
    <div className={cx(
      "p-4 rounded-xl border text-sm",
      variant === "highlight" 
        ? "bg-indigo-600/10 border-indigo-500/20 text-white/80" 
        : "bg-white/[0.02] border-white/8 text-white/60"
    )}>
      {children}
    </div>
  );

  // Table of contents
  const tocItems = [
    { id: "getting-started", label: "Getting Started" },
    { id: "connect-wallet", label: "Connect a Wallet" },
    { id: "core-concepts", label: "Core Concepts" },
    { id: "using-echo", label: "Using Echo (Users)" },
    { id: "creating-agents", label: "Creating Agents" },
    { id: "security", label: "Security & Trust" },
    { id: "network", label: "Network Details" },
    { id: "architecture", label: "Architecture" },
    { id: "faq", label: "FAQ" },
  ];

  return (
    <div className="min-h-screen w-screen bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
      
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="bg-white/10 hover:bg-white/20"
              onClick={onBack}
            >
              ← Back
            </Button>
            <div className="font-semibold text-lg">Documentation</div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-10 flex gap-8">
        
        {/* Sidebar TOC - Hidden on mobile */}
        <aside className="hidden lg:block w-56 shrink-0">
          <div className="sticky top-24 space-y-1">
            <div className="text-xs uppercase tracking-wider text-white/40 mb-3">On this page</div>
            {tocItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block py-1.5 px-3 text-sm text-white/50 hover:text-white hover:bg-white/5 rounded-lg transition"
              >
                {item.label}
              </a>
            ))}
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-12">

          {/* Hero */}
          <div className="space-y-4">
            <h1 className="text-3xl md:text-4xl font-bold text-white">Echo Documentation</h1>
            <p className="text-lg text-white/70 leading-relaxed">
              Welcome to the official documentation for Echo — a Web3-native marketplace for AI agents on Solana.
            </p>
            <InfoCard variant="highlight">
              Echo enables permissionless creation, discovery, and monetization of AI agents using session-based access and wallet-to-wallet USDC payments.
            </InfoCard>
          </div>

          {/* Getting Started */}
          <Section id="getting-started" title="Getting Started">
            <p>If you are new to Echo, start here.</p>
            <p>Echo supports two primary roles:</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/8">
                <div className="font-medium text-white mb-1">👤 Users</div>
                <div className="text-sm text-white/50">Interact with AI agents</div>
              </div>
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/8">
                <div className="font-medium text-white mb-1">🛠 Creators</div>
                <div className="text-sm text-white/50">Build and monetize AI agents</div>
              </div>
            </div>
            <InfoCard>
              No account registration is required. All interactions are wallet-based.
            </InfoCard>
          </Section>

          {/* Connect Wallet */}
          <Section id="connect-wallet" title="Connect a Wallet">
            <p>Echo currently supports <span className="text-white font-medium">Phantom Wallet</span> on Solana.</p>
            <SubSection title="Wallets are used for:">
              <BulletList items={[
                "Authentication",
                "Session payments",
                "Ownership verification"
              ]} />
            </SubSection>
            <InfoCard variant="highlight">
              Echo never has access to private keys.
            </InfoCard>
          </Section>

          {/* Core Concepts */}
          <Section id="core-concepts" title="Core Concepts">
            
            <SubSection title="AI Agents">
              <p>An AI agent is a specialized conversational model published by a creator.</p>
              <p className="text-white/70">Each agent has:</p>
              <BulletList items={[
                "A unique identity",
                "A defined purpose and category",
                "A session price (USDC)",
                "Independent analytics and engagement data"
              ]} />
              <InfoCard>
                Agents operate independently and do not share memory across sessions.
              </InfoCard>
            </SubSection>

            <SubSection title="Sessions">
              <p>A session is a paid interaction between a user and an AI agent.</p>
              <BulletList items={[
                "Sessions are unlocked after payment confirmation",
                "Access is scoped to a single agent",
                "Pricing is per session (no subscriptions)",
                "Sessions are enforced at the platform level"
              ]} />
              <InfoCard variant="highlight">
                This model ensures transparent pricing and fair access.
              </InfoCard>
            </SubSection>

            <SubSection title="Payments">
              <p>All payments on Echo are:</p>
              <BulletList items={[
                "Denominated in USDC",
                "Executed on Solana",
                "Signed directly in the user's wallet"
              ]} />
              <div className="p-4 rounded-xl bg-gradient-to-r from-green-600/10 to-emerald-600/10 border border-green-500/20">
                <p className="text-sm text-green-300">
                  Funds are transferred wallet-to-wallet.<br />
                  <span className="font-medium">Echo does not custody user or creator funds.</span>
                </p>
              </div>
            </SubSection>
          </Section>

          {/* Using Echo */}
          <Section id="using-echo" title="Using Echo (Users)">
            
            <SubSection title="Discover Agents">
              <p>Users can explore agents via:</p>
              <BulletList items={[
                "Explore page",
                "Curated collections",
                "Categories and popularity signals"
              ]} />
              <p className="mt-3">Each agent card displays:</p>
              <BulletList items={[
                "Description",
                "Price per session",
                "Usage and engagement metrics"
              ]} />
            </SubSection>

            <SubSection title="Start a Session">
              <p>To start a session:</p>
              <div className="space-y-2">
                {["Select an agent", "Click Chat", "Confirm payment in your wallet", "Begin interacting with the agent"].map((step, i) => (
                  <div key={i} className="flex gap-3 items-center">
                    <div className="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-xs text-indigo-300 font-medium">
                      {i + 1}
                    </div>
                    <span className="text-sm">{step}</span>
                  </div>
                ))}
              </div>
              <InfoCard variant="highlight">
                Once payment is confirmed, the session is unlocked instantly.
              </InfoCard>
            </SubSection>

            <SubSection title="Chat & Attachments">
              <p>During a session, users can:</p>
              <BulletList items={[
                "Send messages",
                "Upload files and images",
                "View shared content inline"
              ]} />
              <InfoCard>
                Attachments are scoped to the active session and agent.
              </InfoCard>
            </SubSection>
          </Section>

          {/* Creating Agents */}
          <Section id="creating-agents" title="Creating Agents (Creators)">
            
            <SubSection title="Create an Agent">
              <p>Creators can create agents directly from their profile.</p>
              <p className="mt-2">Agent configuration includes:</p>
              <BulletList items={[
                "Name and description",
                "Category",
                "Pricing per session",
                "Public visibility"
              ]} />
              <InfoCard>
                Agents can be edited after creation.
              </InfoCard>
            </SubSection>

            <SubSection title="Publish to Marketplace">
              <p>Once published, an agent becomes discoverable on Echo.</p>
              <p className="mt-2">Creators retain full ownership and control over:</p>
              <BulletList items={[
                "Pricing",
                "Availability",
                "Updates"
              ]} />
            </SubSection>

            <SubSection title="Edit & Manage Agents">
              <p>Creators can:</p>
              <BulletList items={[
                "Update agent metadata",
                "Adjust pricing",
                "Unpublish agents if needed"
              ]} />
              <InfoCard variant="highlight">
                Changes apply immediately to future sessions.
              </InfoCard>
            </SubSection>
          </Section>

          {/* Security */}
          <Section id="security" title="Security & Trust">
            <p>Echo is built with a security-first mindset.</p>
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              {[
                { icon: "🔐", label: "Wallet-based authentication only" },
                { icon: "🏦", label: "No custodial accounts" },
                { icon: "✍️", label: "Explicit transaction signing" },
                { icon: "🚫", label: "No background approvals" },
              ].map((item, i) => (
                <div key={i} className="flex gap-3 items-center p-3 rounded-lg bg-white/[0.02] border border-white/8">
                  <span className="text-xl">{item.icon}</span>
                  <span className="text-sm text-white/70">{item.label}</span>
                </div>
              ))}
            </div>
            <InfoCard variant="highlight">
              Echo never initiates transactions without user confirmation.
            </InfoCard>
          </Section>

          {/* Network Details */}
          <Section id="network" title="Network Details">
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { label: "Blockchain", value: "Solana", icon: "⛓" },
                { label: "Currency", value: "USDC", icon: "💵" },
                { label: "Wallet", value: "Phantom", icon: "👻" },
              ].map((item, i) => (
                <div key={i} className="p-4 rounded-xl bg-gradient-to-br from-white/[0.04] to-transparent border border-white/8 text-center">
                  <div className="text-2xl mb-2">{item.icon}</div>
                  <div className="text-xs text-white/40 uppercase tracking-wider">{item.label}</div>
                  <div className="text-lg font-medium text-white">{item.value}</div>
                </div>
              ))}
            </div>
            <InfoCard>
              Echo is optimized for fast confirmations and low fees.
            </InfoCard>
          </Section>

          {/* Architecture */}
          <Section id="architecture" title="Architecture Overview">
            <p>Echo is designed as a modular platform:</p>
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              {[
                "Frontend-driven interactions",
                "Stateless session handling",
                "Wallet-native authorization",
                "Agent-level isolation"
              ].map((item, i) => (
                <div key={i} className="flex gap-2 items-center p-3 rounded-lg bg-white/[0.02] border border-white/8 text-sm text-white/70">
                  <span className="text-indigo-400">◆</span>
                  {item}
                </div>
              ))}
            </div>
            <InfoCard variant="highlight">
              This allows Echo to scale while maintaining simplicity and transparency.
            </InfoCard>
          </Section>

          {/* FAQ */}
          <Section id="faq" title="FAQ">
            <div className="space-y-4">
              {[
                { q: "Do I need an account?", a: "No. A wallet is sufficient." },
                { q: "Are there subscriptions?", a: "No. All access is session-based." },
                { q: "Who owns the agents?", a: "Creators retain full ownership." },
                { q: "Does Echo store my data?", a: "Conversation history is scoped per agent and stored locally in the browser unless otherwise stated." },
              ].map((item, i) => (
                <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/8">
                  <div className="font-medium text-white mb-2">{item.q}</div>
                  <div className="text-sm text-white/60">{item.a}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* CTA */}
          <div className="pt-8 flex gap-4">
            <Button
              onClick={onBack}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-6"
            >
              Explore Agents →
            </Button>
            <Button
              variant="secondary"
              className="bg-white/5 hover:bg-white/10"
              onClick={() => window.location.hash = "/learn"}
            >
              Learn to Create
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}

// ================= PRIVACY POLICY PAGE =================
function PrivacyPage({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="space-y-3 text-white/70 text-sm leading-relaxed">{children}</div>
    </section>
  );

  const SubSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-2">
      <h3 className="text-base font-medium text-white/90">{title}</h3>
      <div className="space-y-2 text-white/60 text-sm">{children}</div>
    </div>
  );

  const BulletList = ({ items }: { items: string[] }) => (
    <ul className="space-y-1.5 ml-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="text-indigo-400">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );

  const HighlightBox = ({ children, variant = "info" }: { children: React.ReactNode; variant?: "info" | "success" | "warning" }) => {
    const colors = {
      info: "bg-indigo-600/10 border-indigo-500/20 text-indigo-200",
      success: "bg-green-600/10 border-green-500/20 text-green-200",
      warning: "bg-amber-600/10 border-amber-500/20 text-amber-200",
    };
    return (
      <div className={cx("p-4 rounded-xl border text-sm", colors[variant])}>
        {children}
      </div>
    );
  };

  return (
    <div className="min-h-screen w-screen bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
      
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="bg-white/10 hover:bg-white/20"
              onClick={onBack}
            >
              ← Back
            </Button>
            <div className="font-semibold text-lg">Privacy Policy</div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-10">

        {/* Header */}
        <div className="space-y-4">
          <h1 className="text-3xl md:text-4xl font-bold text-white">Privacy Policy</h1>
          <p className="text-sm text-white/40">Last updated: January 2026</p>
          <p className="text-white/70 leading-relaxed">
            Echo ("Echo", "we", "our", or "us") is committed to protecting user privacy and maintaining transparency in how data is collected, stored, and used.
          </p>
          <p className="text-white/60 text-sm leading-relaxed">
            Echo is a Web3-native marketplace for AI agents built on Solana. While the platform minimizes personal data collection, certain information is processed and securely stored in cloud infrastructure to enable core functionality.
          </p>
        </div>

        {/* Overview */}
        <Section title="Overview">
          <p>Echo is designed around the following privacy principles:</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { icon: "🔐", text: "Wallet-based access instead of traditional user accounts" },
              { icon: "🔑", text: "No custody of user funds or private keys" },
              { icon: "🚫", text: "No sale of personal data" },
              { icon: "🎯", text: "Purpose-limited data usage" },
            ].map((item, i) => (
              <div key={i} className="flex gap-3 items-start p-3 rounded-lg bg-white/[0.02] border border-white/8">
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm text-white/70">{item.text}</span>
              </div>
            ))}
          </div>
          <p className="text-white/50 text-sm pt-2">
            This Privacy Policy explains what data we collect, how it is stored, and how it is used.
          </p>
        </Section>

        {/* Information We Collect */}
        <Section title="Information We Collect">
          
          <SubSection title="Wallet Information">
            <p>When you connect a wallet to Echo, we may collect and store:</p>
            <BulletList items={[
              "Public wallet address",
              "Blockchain transaction identifiers related to sessions or payments"
            ]} />
            <HighlightBox variant="success">
              Echo never has access to private keys or signing authority.
            </HighlightBox>
          </SubSection>

          <SubSection title="Account & Session Data">
            <p>To provide persistent functionality, Echo securely stores the following data in cloud infrastructure:</p>
            <BulletList items={[
              "Active and historical chat sessions",
              "Messages exchanged with AI agents",
              "Session metadata (timestamps, agent identifiers)",
              "Uploaded files and images associated with sessions"
            ]} />
            <p className="text-white/50 text-sm pt-2">
              This data is scoped per user and per agent and is not shared across unrelated sessions.
            </p>
          </SubSection>

          <SubSection title="Usage & Technical Data">
            <p>Echo may collect limited technical information, including:</p>
            <BulletList items={[
              "Page interactions and feature usage",
              "Performance metrics",
              "Error logs"
            ]} />
            <p className="text-white/50 text-sm pt-1">
              This data is used strictly for platform reliability, security, and improvement.
            </p>
          </SubSection>

          <SubSection title="File & Attachment Storage">
            <p>Files and images uploaded to Echo:</p>
            <BulletList items={[
              "Are stored securely in cloud storage",
              "Are accessible only within the relevant session",
              "Are not publicly indexed or shared"
            ]} />
            <HighlightBox variant="info">
              Echo does not use uploaded content for training AI models.
            </HighlightBox>
          </SubSection>
        </Section>

        {/* Information We Do Not Collect */}
        <Section title="Information We Do Not Collect">
          <p>Echo does not:</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {[
              "Collect names, emails, or phone numbers",
              "Require user registration accounts",
              "Store private wallet credentials",
              "Sell or monetize personal data",
              "Track users across external websites"
            ].map((item, i) => (
              <div key={i} className="flex gap-2 items-center text-sm text-white/60">
                <span className="text-red-400">✕</span>
                {item}
              </div>
            ))}
          </div>
        </Section>

        {/* Payments & Blockchain Data */}
        <Section title="Payments & Blockchain Data">
          <p>All payments on Echo are:</p>
          <BulletList items={[
            "Executed directly on-chain via Solana",
            "Authorized by the user's wallet",
            "Publicly verifiable on the blockchain"
          ]} />
          <HighlightBox variant="success">
            Echo does not store payment methods, private keys, or recovery phrases.
          </HighlightBox>
        </Section>

        {/* How We Use Information */}
        <Section title="How We Use Information">
          <p>Collected information is used solely to:</p>
          <BulletList items={[
            "Enable AI agent sessions",
            "Process and verify payments",
            "Store conversations and files",
            "Maintain platform performance",
            "Prevent abuse and ensure security"
          ]} />
          <HighlightBox variant="info">
            Echo does not use user data for advertising or profiling.
          </HighlightBox>
        </Section>

        {/* Cloud Infrastructure & Security */}
        <Section title="Cloud Infrastructure & Security">
          <p>Echo stores session and content data in secure cloud infrastructure operated by trusted service providers.</p>
          <p className="mt-3">Security measures include:</p>
          <div className="grid sm:grid-cols-2 gap-3 mt-2">
            {[
              { icon: "🔒", label: "Encrypted connections" },
              { icon: "🛡", label: "Access controls" },
              { icon: "👤", label: "Separation of user data by wallet address" },
              { icon: "🔐", label: "Limited internal access" },
            ].map((item, i) => (
              <div key={i} className="flex gap-3 items-center p-3 rounded-lg bg-white/[0.02] border border-white/8">
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm text-white/70">{item.label}</span>
              </div>
            ))}
          </div>
          <p className="text-white/50 text-sm pt-3">
            While reasonable safeguards are in place, no system can be guaranteed to be fully secure.
          </p>
        </Section>

        {/* Third-Party Services */}
        <Section title="Third-Party Services">
          <p>Echo may rely on third-party providers for:</p>
          <BulletList items={[
            "Cloud hosting and storage",
            "Blockchain RPC access",
            "Monitoring and analytics"
          ]} />
          <p className="text-white/50 text-sm pt-2">
            These providers process data only as necessary to operate the platform and are contractually required to meet applicable security and privacy standards.
          </p>
        </Section>

        {/* Data Retention */}
        <Section title="Data Retention">
          <p>
            Session data is retained only as long as necessary to provide platform functionality, comply with legal obligations, or resolve disputes.
          </p>
          <HighlightBox variant="info">
            Users may request deletion of stored data by disconnecting their wallet and contacting support.
          </HighlightBox>
        </Section>

        {/* User Rights */}
        <Section title="User Rights">
          <p>Depending on jurisdiction, users may have the right to:</p>
          <BulletList items={[
            "Request access to stored data",
            "Request data deletion",
            "Withdraw consent by discontinuing use of the platform"
          ]} />
          <p className="text-white/50 text-sm pt-2">
            Because Echo uses wallet-based access, identity verification is limited to wallet ownership.
          </p>
        </Section>

        {/* Children's Privacy */}
        <Section title="Children's Privacy">
          <HighlightBox variant="warning">
            Echo is not intended for individuals under the age of 18.<br />
            We do not knowingly collect data from minors.
          </HighlightBox>
        </Section>

        {/* Changes to This Policy */}
        <Section title="Changes to This Policy">
          <p>
            Echo may update this Privacy Policy periodically. Updates will be reflected by revising the "Last updated" date.
          </p>
          <p className="text-white/50 text-sm">
            Continued use of the platform constitutes acceptance of the updated policy.
          </p>
        </Section>

        {/* Contact */}
        <Section title="Contact">
          <p>
            For questions regarding this Privacy Policy or data practices, please contact Echo through the official support channels listed on the platform.
          </p>
        </Section>

        {/* Back button */}
        <div className="pt-8">
          <Button
            onClick={onBack}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-6"
          >
            ← Back to Echo
          </Button>
        </div>

      </div>
    </div>
  );
}

function ProfileStatsView({ onBack, agents, address, purchases }: { onBack: () => void; agents: Agent[]; address: string | null; purchases: { id: string; agentId: string; priceUSDC: number; ts: number }[]; }) {
  const mine = agents.filter(a => a.creator && a.creator === (address || ''));
  const totalSessions = mine.reduce((s,a)=>s+a.sessions,0);
  const totalLikes = mine.reduce((s,a)=>s+a.likes,0);
  const totalRevenue = purchases.filter(p => mine.some(a=>a.id===p.agentId)).reduce((s,p)=>s+p.priceUSDC,0);
  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
      <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="secondary" className="bg-white/10 hover:bg-white/20" onClick={onBack}>← Back</Button>
            <div className="font-semibold">Creator Stats</div>
          </div>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-white/[.04] text-center p-6">
          <div className="text-white/60 text-sm">My Agents</div>
          <div className="text-3xl font-semibold mt-1">{mine.length}</div>
        </Card>
        <Card className="bg-white/[.04] text-center p-6">
          <div className="text-white/60 text-sm">My Sessions</div>
          <div className="text-3xl font-semibold mt-1">{totalSessions.toLocaleString()}</div>
        </Card>
        <Card className="bg-white/[.04] text-center p-6">
          <div className="text-white/60 text-sm">My Likes</div>
          <div className="text-3xl font-semibold mt-1">{totalLikes.toLocaleString()}</div>
        </Card>
        <Card className="bg-white/[.04] text-center p-6 sm:col-span-3">
          <div className="text-white/60 text-sm">Revenue</div>
          <div className="text-3xl font-semibold mt-1">{totalRevenue.toFixed(2)} USDC</div>
        </Card>
      </div>
    </div>
  );
}


function RailAgentCard({
  agent,
  onView,
  onChat,
  badge = "HOT",
}: {
  agent: Agent;
  onView: () => void;
  onChat: () => void;
  badge?: string;
}) {
  return (
    <div className="shrink-0 w-[300px] sm:w-[340px]">
      <div className="rounded-[28px] border border-white/10 bg-white/[.03] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
        {/* TOP BLACK HEADER (как на главной) */}
        <div className="relative h-[92px] bg-black/70">
          <div className="absolute left-5 top-5 h-12 w-12 rounded-2xl bg-white/10 border border-white/10 grid place-items-center text-xl">
            {agent.avatar}
          </div>

          <div className="absolute right-5 top-5">
            <span className="text-[11px] px-3 py-1 rounded-full border border-white/15 bg-black/40 text-white/70">
              {badge}
            </span>
          </div>

          {/* лёгкий затемняющий градиент снизу шапки */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent" />
        </div>

        {/* CONTENT */}
        <div className="px-6 pt-5 pb-6">
          <div className="text-xl font-semibold text-white leading-tight">
            {agent.name}
          </div>

          <div className="mt-1 text-sm text-white/55 line-clamp-2">
            {agent.tagline}
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-white/45">
            <div>{agent.sessions.toLocaleString()} sessions</div>
            <div>{agent.likes.toLocaleString()} likes</div>
          </div>

          <div className="mt-5 flex items-end justify-between">
            <div className="text-lg font-semibold text-white">
              {agent.priceUSDC.toFixed(2)} USDC
            </div>

            <button
              onClick={onChat}
              className="
                rounded-xl px-6 py-3 text-sm font-semibold text-white
                bg-gradient-to-r from-cyan-500/60 via-indigo-500/50 to-emerald-500/60
                border border-white/10
                hover:opacity-95 active:scale-[0.99]
                transition
              "
            >
              Chat
            </button>
          </div>

          {/* если хочешь кнопку View как на некоторых местах */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={onView}
              className="
                text-xs text-white/55 hover:text-white/85
                underline underline-offset-4
                transition
              "
            >
              View
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



function AgentDetailView({
  agent,
  onBack,
  onOpenPay,
  liked,
  onLike,
  allAgents,
  reviews,
  onAddReview,
}: {
  agent: Agent | null;
  onBack: () => void;
  onOpenPay: (agent: Agent) => void;
  liked: Record<string, boolean>;
  onLike: (id: string) => void;
  allAgents: Agent[];
  reviews: Record<string, AgentReview[]>;
  onAddReview: (agentId: string, data: { rating: number; text: string; user?: string }) => void;
}) {

  const [reviewName, setReviewName] = useState("");
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewText, setReviewText] = useState("");
  
  // Scroll to top when Agent Detail view opens
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [agent?.id]); // Reset scroll when agent changes
  
  const creatorAgents = useMemo(() => {
    if (!agent) return [];
  
    // 1) если есть creatorWallet — это самый надежный ключ
    const keyWallet = agent.creatorWallet;
  
    // 2) если нет — fallback на creator (у тебя это address/short)
    const keyCreator = agent.creator;
  
    return (allAgents || [])
      .filter((a) => {
        if (!a) return false;
  
        const sameWallet =
          keyWallet && a.creatorWallet && a.creatorWallet === keyWallet;
  
        const sameCreator =
          !keyWallet && keyCreator && a.creator && a.creator === keyCreator;
  
        return (sameWallet || sameCreator) && a.id !== agent.id;
      })
      .slice(0, 10);
  }, [agent, allAgents]);
  
  if (!agent) {
    return (
      <div className="min-h-screen w-screen overflow-x-hidden bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
        <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                className="bg-white/10 hover:bg-white/20"
                onClick={onBack}
              >
                ← Back
              </Button>
              <div className="font-semibold">Agent not found</div>
            </div>
          </div>
        </header>
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="text-white/60 text-sm">
            This agent does not exist or was removed.
          </div>
        </div>
      </div>
    );
  }

  const isLiked = !!liked[agent.id];

    // --- Reviews for this agent ---
    const agentReviews = reviews[agent.id] || [];
    const averageRating =
      agentReviews.length > 0
        ? agentReviews.reduce((s, r) => s + r.rating, 0) / agentReviews.length
        : 0;
  
    function handleSubmitReview(e: React.FormEvent) {
      e.preventDefault();
      if (!reviewText.trim()) return;
  
      const agentId = agent?.id;
      if (!agentId) return;
      
      onAddReview(agentId, {
        rating: reviewRating,
        text: reviewText,
        user: reviewName,
      });
       
  
      setReviewText("");
      // имя и рейтинг можно не сбрасывать, чтобы юзер мог писать несколько отзывов подряд
    }
  
  // 🔹 лимит агентов этого же создателя
  const MAX_CREATOR = 10;
  // 🔹 лимит похожих агентов
  const MAX_SIMILAR = 10;

  // 🔹 есть ли активная сессия (локально)
  const hasActiveSession =
    typeof window !== "undefined" ? !!getActiveSession(agent.id) : false;

  

  // 🔹 сначала пытаемся найти похожих по категориям
  const similarByCategory = allAgents
    .filter((a) => a.id !== agent.id)
    .filter((a) =>
      a.categories.some((cat) => agent.categories.includes(cat))
    );

  // 🔹 сортировка по популярности
  function sortByPopularity(list: Agent[]) {
    return list.sort((a, b) => {
      const diffLikes = b.likes - a.likes;
      if (diffLikes !== 0) return diffLikes;
      return b.sessions - a.sessions;
    });
  }

  let similarAgents = sortByPopularity(similarByCategory).slice(
    0,
    MAX_SIMILAR
  );

  // 🔹 fallback: если по категориям никого нет — просто топовые
  if (similarAgents.length === 0) {
    similarAgents = sortByPopularity(
      allAgents.filter((a) => a.id !== agent.id)
    ).slice(0, MAX_SIMILAR);
  }

  // 🔹 refs для горизонтальных рядов


  const SCROLL_STEP = 260;

  const scrollRow = (
    ref: React.MutableRefObject<HTMLDivElement | null>,
    dir: "left" | "right"
  ) => {
    const el = ref.current;
    if (!el) return;
    const delta = dir === "left" ? -SCROLL_STEP : SCROLL_STEP;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen w-screen overflow-x-hidden bg-gradient-to-b from-black via-[#0b0b1a] to-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="bg-white/10 hover:bg-white/20"
              onClick={onBack}
            >
              ← Back
            </Button>
            <div className="font-semibold">Agent • {agent.name}</div>
          </div>
        </div>
      </header>

      {/* Верхний контент: описание + прайс */}
      <div className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-[2fr,1.4fr] gap-6">
        {/* Левый блок — описание */}
        <div>
          <Card className="bg-white/[.04] border-white/10">
            <CardContent className="p-6 flex gap-4">
              <div className="h-16 w-16 rounded-2xl bg-white/10 grid place-items-center text-3xl">
                {agent.avatar}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xl font-semibold">{agent.name}</div>
                  {agent.categories.map((c) => (
                    <Badge
                      key={c}
                      className="bg-white/10 border-white/10 text-xs"
                    >
                      {c}
                    </Badge>
                  ))}
                </div>
                <div className="text-sm text-white/70">{agent.tagline}</div>
                {agent.creator && (
                  <div className="text-xs text-white/50">
                    Creator: <span className="font-mono">{agent.creator}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          {/* Description */}
{agent.description && agent.description.trim() !== "" && (
  <Card className="bg-white/[.03] border-white/10 mt-4">
    <CardHeader>
      <CardTitle className="text-sm">Description</CardTitle>
      <CardDescription className="text-xs text-white/60">
        What this agent does and how to use it.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="text-sm whitespace-pre-wrap text-white/80">
        {agent.description}
      </div>
    </CardContent>
  </Card>
)}
          {agent.engineProvider === "creator_backend" && (
  <Card className="bg-white/[.03] border-white/10 mt-4">
    <CardHeader>
      <CardTitle className="text-sm">Backend</CardTitle>
      <CardDescription className="text-xs text-white/60">
        This agent runs on the creator’s API.
      </CardDescription>
    </CardHeader>

    <CardContent className="space-y-2 text-xs text-white/70">
      <div className="flex flex-col gap-1">
        <span className="text-white/50">Chat endpoint</span>
        <span className="font-mono break-all text-white/80">
          {agent.engineApiUrl || "—"}
        </span>
      </div>

      {agent.ragEndpointUrl && (
        <div className="flex flex-col gap-1">
          <span className="text-white/50">RAG endpoint</span>
          <span className="font-mono break-all text-white/80">
            {agent.ragEndpointUrl}
          </span>
        </div>
      )}

      {agent.toolsDescription && (
        <div className="flex flex-col gap-1">
          <span className="text-white/50">Tools</span>
          <span className="text-white/80">{agent.toolsDescription}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-white/50">Auth</span>
        <span className={agent.authToken ? "text-emerald-300" : "text-white/40"}>
          {agent.authToken ? "configured" : "not set"}
        </span>
      </div>
    </CardContent>
  </Card>
)}

          <Card className="bg-white/[.03] border-white/10 mt-4">
            <CardHeader>
              <CardTitle className="text-sm">Agent behavior</CardTitle>
              <CardDescription className="text-xs text-white/60">
                System prompt / persona used to drive this agent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm whitespace-pre-wrap text-white/80">
                {agent.promptPreview || "No prompt provided yet."}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Правый блок — цена, статы, кнопки */}
        <div className="space-y-4">
          <Card className="bg-white/[.05] border-white/10">
            <CardContent className="p-5 space-y-4">
              <div>
                <div className="text-xs text-white/60">Price per session</div>
                <div className="text-2xl font-semibold mt-1">
                  {formatUSDC(agent.priceUSDC)}
                </div>
              </div>

              <div className="flex gap-3 text-sm text-white/70">
                <div>
                  <div className="text-xs text-white/50">Likes</div>
                  <div className="font-semibold">
                    {agent.likes.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/50">Sessions</div>
                  <div className="font-semibold">
                    {agent.sessions.toLocaleString()}
                  </div>
                </div>
              </div>
              {agentReviews.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <span className="text-yellow-300">
                    ★ {averageRating.toFixed(1)}
                  </span>
                  <span className="text-xs text-white/50">
                    ({agentReviews.length} review
                    {agentReviews.length > 1 ? "s" : ""})
                  </span>
                </div>
              )}

              {(agent.maxMessagesPerSession || agent.maxDurationMinutes) && (
                <div className="text-xs text-white/60">
                  Session limit:{" "}
                  <span className="font-medium">
                    {agent.maxMessagesPerSession
                      ? `${agent.maxMessagesPerSession} messages`
                      : "∞ messages"}
                    {" • "}
                    {agent.maxDurationMinutes
                      ? `${agent.maxDurationMinutes} min`
                      : "∞ time"}
                  </span>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className={cx(
                    "flex-1 bg-white/10 hover:bg-white/20 flex items-center justify-center gap-2",
                    isLiked
                      ? "text-rose-300 border border-rose-400/30 bg-rose-500/10"
                      : ""
                  )}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onLike(agent.id);
                  }}
                >
                  <Heart
                    className={cx(
                      "h-4 w-4",
                      isLiked ? "fill-rose-500 text-rose-500" : ""
                    )}
                  />
                  {isLiked ? "Unlike" : "Like"}
                </Button>
                <Button
                  className="flex-1 gap-2"
                  onClick={() => onOpenPay(agent)}
                >
                  <Bot className="h-4 w-4" />
                  {hasActiveSession ? "Resume session" : "Start session"}
                </Button>
              </div>

              <div className="text-[11px] text-white/50">
                You will pay per session. After successful payment your chat
                with this agent will be unlocked.
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/[.03] border-white/10">
            <CardHeader>
              <CardTitle className="text-sm">Tips</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc list-inside text-xs text-white/60 space-y-1">
                <li>Start with a clear question to get the best answer.</li>
                <li>Describe your context (goals, level, constraints).</li>
                <li>Save this agent if you plan to use it frequently.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

           {/* Нижние блоки: другие агенты + похожие + отзывы */}
           <div className="max-w-5xl mx-auto px-4 pb-20 space-y-8">
        {/* More from this creator — SAME DESIGN AS HOME */}
{creatorAgents.length > 0 && (
  <MarketplaceRail
    railId="creator"
    kicker="Creator"
    title="More from this creator"
    subtitle="Other agents published by the same creator."
    items={creatorAgents}
    onOpen={(a) =>
      (window.location.hash = `/agent?id=${encodeURIComponent(a.id)}`)
    }
    onChat={(a) => onOpenPay(a)}
  />
)}


       
{/* Similar agents — SAME DESIGN AS HOME */}
{similarAgents.length > 0 && (
  <MarketplaceRail
    railId="similar"
    kicker="Marketplace"
    title="Similar agents"
    subtitle="Based on categories & popularity"
    items={similarAgents}
    onOpen={(a) =>
      (window.location.hash = `/agent?id=${encodeURIComponent(a.id)}`)
    }
    onChat={(a) => onOpenPay(a)}
  />
)}




        

        {/* 🔥 Reviews — САМЫЙ НИЗ СТРАНИЦЫ */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-white">Reviews</h2>

          {/* Список отзывов */}
          {agentReviews.length === 0 ? (
            <div className="text-xs text-white/50">
              No reviews yet. Be the first to leave one.
            </div>
          ) : (
            <div className="space-y-3">
              {agentReviews
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((r) => (
                  <Card
                    key={r.id}
                    className="bg-white/[.02] border-white/10"
                  >
                    <CardContent className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-white/80">
                          {r.user}
                        </span>
                        <span className="text-xs text-yellow-300">
                          {"★".repeat(r.rating)}
                          <span className="text-white/30">
                            {"★".repeat(5 - r.rating)}
                          </span>
                        </span>
                      </div>
                      <div className="text-xs text-white/70 whitespace-pre-wrap">
                        {r.text}
                      </div>
                      <div className="text-[10px] text-white/40">
                        {new Date(r.createdAt).toLocaleString()}
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}

          {/* Форма добавления отзыва */}
          <Card className="bg-white/[.02] border-white/10">
            <CardHeader>
              <CardTitle className="text-sm">Add your review</CardTitle>
              <CardDescription className="text-xs text-white/60">
                Reviews are stored locally in your browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={handleSubmitReview}>
                {/* Name */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-white/60">
                    Name (optional)
                  </label>
                  <Input
                    value={reviewName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReviewName(e.target.value)}
                    placeholder="Your name or nickname"
                    className="bg-white/5 border-white/10 text-xs"
                  />
                </div>

                {/* Rating */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-white/60">Rating</label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setReviewRating(n)}
                        className={cx(
                          "h-7 w-7 rounded-full text-xs flex items-center justify-center border",
                          n <= reviewRating
                            ? "bg-yellow-400/20 border-yellow-300 text-yellow-200"
                            : "bg-white/5 border-white/15 text-white/40"
                        )}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="ml-2 text-[11px] text-white/50">
                      {reviewRating}/5
                    </span>
                  </div>
                </div>

                {/* Text */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-white/60">Review</label>
                  <Textarea
                    rows={3}
                    value={reviewText}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReviewText(e.target.value)}
                    placeholder="What did you like or dislike?"
                    className="bg-white/5 border-white/10 text-xs"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={!reviewText.trim()}
                    className="text-xs px-3 py-1"
                  >
                    Submit review
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

