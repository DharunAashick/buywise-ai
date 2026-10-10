import { toCents } from "../lib/money.js";
import type { Product } from "../domain/types.js";

// Offline fallback used ONLY when no CHANNEL3_API_KEY is configured, so the project can be run
// by judges without third-party keys. Every product is tagged source:"demo-catalog" and the UI
// shows a "Demo catalog" badge so this data is never presented as live retailer pricing.
// Prices are representative US list prices (USD) as of late 2026.

type Seed = {
  id: string;
  title: string;
  brand: string;
  category: string;
  tags: string[];
  price: number;
  compareAt?: number;
  retailer: string;
  monthly?: number;
  features: string[];
};

const SEEDS: Seed[] = [
  // Consoles
  { id: "demo-ps5-slim-digital", title: "PlayStation 5 Slim Digital Edition Console", brand: "Sony", category: "Video Game Consoles", tags: ["console", "playstation", "ps5", "gaming", "sony"], price: 449.99, compareAt: 499.99, retailer: "target.com", features: ["1TB SSD", "4K up to 120fps", "DualSense controller included", "No disc drive"] },
  { id: "demo-ps5-slim-disc", title: "PlayStation 5 Slim Console (Disc)", brand: "Sony", category: "Video Game Consoles", tags: ["console", "playstation", "ps5", "gaming", "sony", "disc"], price: 499.99, retailer: "bestbuy.com", features: ["1TB SSD", "Ultra HD Blu-ray drive", "DualSense controller included"] },
  { id: "demo-ps5-bundle-cod", title: "PlayStation 5 Slim Digital + Call of Duty Bundle", brand: "Sony", category: "Video Game Console Bundles", tags: ["console", "playstation", "ps5", "bundle", "gaming", "game"], price: 479.99, compareAt: 519.99, retailer: "walmart.com", features: ["PS5 Slim Digital console", "Full game voucher included", "DualSense controller"] },
  { id: "demo-xbox-series-s", title: "Xbox Series S 512GB Console", brand: "Microsoft", category: "Video Game Consoles", tags: ["console", "xbox", "series s", "gaming", "microsoft"], price: 379.99, retailer: "bestbuy.com", features: ["512GB SSD", "1440p up to 120fps", "All-digital", "Wireless controller included"] },
  { id: "demo-xbox-series-x", title: "Xbox Series X 1TB Console", brand: "Microsoft", category: "Video Game Consoles", tags: ["console", "xbox", "series x", "gaming", "microsoft"], price: 599.99, retailer: "amazon.com", features: ["1TB SSD", "True 4K gaming", "Disc drive", "Wireless controller included"] },
  { id: "demo-xbox-s-bundle", title: "Xbox Series S Starter Bundle with 3 Months Game Pass Ultimate", brand: "Microsoft", category: "Video Game Console Bundles", tags: ["console", "xbox", "bundle", "game pass", "gaming", "subscription"], price: 399.99, compareAt: 439.98, retailer: "microsoft.com", features: ["Xbox Series S 512GB", "3 months Game Pass Ultimate", "Wireless controller"] },
  { id: "demo-switch-2", title: "Nintendo Switch 2 Console", brand: "Nintendo", category: "Video Game Consoles", tags: ["console", "handheld", "nintendo", "switch", "gaming", "portable"], price: 449.99, retailer: "target.com", features: ["7.9in 1080p screen", "Dock for TV play", "Joy-Con 2 controllers", "Portable + TV"] },
  { id: "demo-steam-deck-oled", title: "Steam Deck OLED 512GB Handheld Gaming PC", brand: "Valve", category: "Handheld Gaming PCs", tags: ["handheld", "pc", "steam", "portable", "gaming", "valve"], price: 549.0, retailer: "steampowered.com", features: ["7.4in HDR OLED", "Plays your Steam library", "512GB NVMe", "Portable"] },
  { id: "demo-rog-ally", title: "ASUS ROG Ally Handheld Gaming PC", brand: "ASUS", category: "Handheld Gaming PCs", tags: ["handheld", "pc", "windows", "portable", "gaming", "asus"], price: 499.99, compareAt: 649.99, retailer: "bestbuy.com", features: ["7in 120Hz display", "Windows 11", "Runs Game Pass for PC + Steam"] },

  // PCs
  { id: "demo-pc-prebuilt-4060", title: "Prebuilt Gaming Desktop - Ryzen 5, RTX 4060, 16GB, 1TB", brand: "CyberPowerPC", category: "Gaming Desktops", tags: ["pc", "desktop", "gaming", "rtx", "computer"], price: 849.99, compareAt: 999.99, retailer: "bestbuy.com", features: ["RTX 4060 8GB", "Ryzen 5 7600", "16GB DDR5", "1TB NVMe", "Windows 11"] },
  { id: "demo-laptop-4050", title: "15.6in Gaming Laptop - Core i5, RTX 4050, 16GB, 512GB", brand: "Acer", category: "Gaming Laptops", tags: ["pc", "laptop", "gaming", "rtx", "computer", "portable"], price: 799.99, compareAt: 949.99, retailer: "amazon.com", features: ["RTX 4050 6GB", "144Hz display", "16GB RAM", "512GB SSD"] },
  { id: "demo-monitor-1080p", title: "24in 1080p 165Hz Gaming Monitor", brand: "AOC", category: "Monitors", tags: ["monitor", "display", "pc", "accessory"], price: 129.99, retailer: "amazon.com", features: ["165Hz", "1ms response", "FreeSync"] },
  { id: "demo-kb-mouse", title: "Gaming Keyboard and Mouse Combo", brand: "Logitech", category: "PC Accessories", tags: ["keyboard", "mouse", "pc", "accessory"], price: 59.99, retailer: "bestbuy.com", features: ["RGB keyboard", "8000 DPI mouse"] },

  // Controllers & accessories
  { id: "demo-dualsense", title: "DualSense Wireless Controller - White", brand: "Sony", category: "Game Controllers", tags: ["controller", "playstation", "ps5", "accessory", "second controller"], price: 74.99, retailer: "target.com", features: ["Haptic feedback", "Adaptive triggers"] },
  { id: "demo-xbox-controller", title: "Xbox Wireless Controller - Carbon Black", brand: "Microsoft", category: "Game Controllers", tags: ["controller", "xbox", "pc", "accessory", "second controller"], price: 59.99, retailer: "bestbuy.com", features: ["Works with Xbox, PC and mobile", "Bluetooth"] },
  { id: "demo-pro-controller-2", title: "Nintendo Switch 2 Pro Controller", brand: "Nintendo", category: "Game Controllers", tags: ["controller", "nintendo", "switch", "accessory"], price: 84.99, retailer: "target.com", features: ["HD Rumble 2", "40hr battery"] },
  { id: "demo-headset", title: "Wired Gaming Headset with Mic", brand: "HyperX", category: "Gaming Headsets", tags: ["headset", "audio", "accessory", "microphone"], price: 49.99, compareAt: 69.99, retailer: "amazon.com", features: ["Works with PS5, Xbox, PC, Switch", "Detachable mic"] },
  { id: "demo-storage-xbox", title: "Seagate 1TB Storage Expansion Card for Xbox Series X|S", brand: "Seagate", category: "Console Storage", tags: ["storage", "xbox", "accessory", "ssd"], price: 149.99, retailer: "bestbuy.com", features: ["Plug-and-play", "Same speed as internal SSD"] },
  { id: "demo-charging-ps5", title: "DualSense Charging Station", brand: "Sony", category: "Console Accessories", tags: ["charging", "playstation", "ps5", "accessory"], price: 29.99, retailer: "target.com", features: ["Charges two controllers"] },
  { id: "demo-microsd-512", title: "SanDisk 512GB microSDXC Card", brand: "SanDisk", category: "Memory Cards", tags: ["storage", "switch", "steam deck", "handheld", "accessory", "microsd"], price: 39.99, retailer: "amazon.com", features: ["Expands handheld storage"] },

  // Games
  { id: "demo-game-ps5-spiderman", title: "Marvel's Spider-Man 2 (PS5)", brand: "Sony", category: "Video Games", tags: ["game", "playstation", "ps5", "action"], price: 49.99, compareAt: 69.99, retailer: "walmart.com", features: ["PS5 exclusive", "Single player"] },
  { id: "demo-game-ps5-fc", title: "EA SPORTS FC 26 (PS5)", brand: "EA", category: "Video Games", tags: ["game", "playstation", "ps5", "sports", "football", "multiplayer"], price: 69.99, retailer: "target.com", features: ["Online multiplayer", "Requires PS Plus for online"] },
  { id: "demo-game-xbox-forza", title: "Forza Horizon 5 (Xbox / PC)", brand: "Microsoft", category: "Video Games", tags: ["game", "xbox", "pc", "racing", "game pass"], price: 39.99, compareAt: 59.99, retailer: "amazon.com", features: ["Included with Game Pass", "Open-world racing"] },
  { id: "demo-game-mario-kart", title: "Mario Kart World (Nintendo Switch 2)", brand: "Nintendo", category: "Video Games", tags: ["game", "nintendo", "switch", "racing", "multiplayer", "family"], price: 79.99, retailer: "target.com", features: ["Up to 24 players online", "Local split-screen"] },
  { id: "demo-game-steam-credit", title: "Steam Wallet Gift Card $50", brand: "Valve", category: "Digital Game Credit", tags: ["game", "pc", "steam", "steam deck", "credit", "gift card"], price: 50.0, retailer: "steampowered.com", features: ["Use on any Steam game"] },

  // Subscriptions (recurring, monthly)
  { id: "demo-sub-game-pass-ultimate", title: "Xbox Game Pass Ultimate (monthly)", brand: "Microsoft", category: "Game Subscriptions", tags: ["subscription", "xbox", "pc", "game pass", "games library", "online"], price: 0, retailer: "xbox.com", monthly: 19.99, features: ["Hundreds of games on console, PC and cloud", "Online multiplayer included", "Day-one first-party releases"] },
  { id: "demo-sub-game-pass-pc", title: "PC Game Pass (monthly)", brand: "Microsoft", category: "Game Subscriptions", tags: ["subscription", "pc", "game pass", "games library", "handheld"], price: 0, retailer: "xbox.com", monthly: 11.99, features: ["Hundreds of PC games", "Works on Windows handhelds"] },
  { id: "demo-sub-ps-plus-essential", title: "PlayStation Plus Essential (monthly)", brand: "Sony", category: "Game Subscriptions", tags: ["subscription", "playstation", "ps5", "online", "multiplayer"], price: 0, retailer: "playstation.com", monthly: 9.99, features: ["Online multiplayer", "Monthly games", "Cloud saves"] },
  { id: "demo-sub-ps-plus-extra", title: "PlayStation Plus Extra (monthly)", brand: "Sony", category: "Game Subscriptions", tags: ["subscription", "playstation", "ps5", "games library", "online"], price: 0, retailer: "playstation.com", monthly: 14.99, features: ["Game catalog of hundreds of titles", "Online multiplayer"] },
  { id: "demo-sub-nintendo-online", title: "Nintendo Switch Online (monthly)", brand: "Nintendo", category: "Game Subscriptions", tags: ["subscription", "nintendo", "switch", "online", "multiplayer"], price: 0, retailer: "nintendo.com", monthly: 3.99, features: ["Online play", "Classic games library"] },
];

export const DEMO_PRODUCTS: Product[] = SEEDS.map((s) => {
  const offer = {
    retailer: s.retailer,
    url: `https://${s.retailer}/`,
    price: toCents(s.price),
    compareAtPrice: s.compareAt ? toCents(s.compareAt) : undefined,
    currency: "USD",
    availability: "InStock" as const,
  };
  return {
    id: s.id,
    title: s.title,
    brand: s.brand,
    category: s.category,
    keyFeatures: s.features,
    offers: [offer],
    bestOffer: offer,
    recurringMonthly: s.monthly ? toCents(s.monthly) : undefined,
    source: "demo-catalog" as const,
    description: s.tags.join(", "),
  };
});

const TAGS = new Map(SEEDS.map((s) => [s.id, [...s.tags, s.brand.toLowerCase(), s.category.toLowerCase()]]));

export function demoSearch(query: string, opts: { maxPrice?: number; minPrice?: number; limit?: number } = {}): Product[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const scored = DEMO_PRODUCTS.map((p) => {
    const hay = `${p.title.toLowerCase()} ${(TAGS.get(p.id) ?? []).join(" ")}`;
    const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? (p.title.toLowerCase().includes(t) ? 2 : 1) : 0), 0);
    return { p, score };
  })
    .filter(({ p, score }) => {
      if (score === 0) return false;
      const price = (p.bestOffer?.price ?? 0) / 100;
      if (opts.maxPrice !== undefined && price > opts.maxPrice && !p.recurringMonthly) return false;
      if (opts.minPrice !== undefined && price < opts.minPrice) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 8).map((s) => s.p);
}
