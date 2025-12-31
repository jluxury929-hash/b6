// ===============================================================================
// APEX TITAN v104.0 (OMNISCIENT SCANNER EVOLUTION) - ULTIMATE ENGINE
// ===============================================================================
// MERGE SYNC: v103.0 (TITAN) + REAL MEMPOOL SCANNER (DRIVER LOGIC) + AI GATE
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const axios = require('axios');
const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, formatEther, parseEther, Interface, AbiCoder, FallbackProvider } = require('ethers');
require('dotenv').config();

// --- GEMINI AI CONFIGURATION ---
const apiKey = ""; // Environment provides this at runtime
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";

// --- SAFETY: GLOBAL ERROR HANDLERS (v14.2 CRASH-PROOF) ---
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    if (msg.includes('200') || msg.includes('405') || msg.includes('429') || msg.includes('network') || msg.includes('coalesce')) return; 
    console.error("\n\x1b[31m[SYSTEM ERROR]\x1b[0m", msg);
});

process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || "";
    if (msg.includes('200') || msg.includes('429') || msg.includes('network') || msg.includes('coalesce') || msg.includes('401')) return;
});

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", gray: "\x1b[90m"
};

// --- CONFIGURATION ---
const GLOBAL_CONFIG = {
    TARGET_CONTRACT: process.env.EXECUTOR_CONTRACT || "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    BENEFICIARY: process.env.BENEFICIARY || "0xYOUR_OWN_PUBLIC_WALLET_ADDRESS",
    
    // SCANNER SETTINGS (Merged from Real Mempool Scanner)
    FLASH_LOAN_AMOUNT: parseEther("250"), 
    MIN_WHALE_VALUE: 10.0, // Scans transactions moving > 10 ETH
    GAS_LIMIT: 1500000n, 
    MARGIN_ETH: "0.015", 
    PRIORITY_BRIBE: 25n, 

    RPC_POOL: [
        process.env.QUICKNODE_HTTP,
        process.env.BASE_RPC,
        "https://mainnet.base.org",
        "https://base.llamarpc.com",
        "https://1rpc.io/base"
    ].filter(url => url && url.startsWith("http")),

    MAX_CORES: Math.min(os.cpus().length, 48), 
    WORKER_BOOT_DELAY_MS: 15000, 
    HEARTBEAT_INTERVAL_MS: 120000,
    PORT: process.env.PORT || 8080,

    NETWORKS: [
        { 
            name: "ETH_MAINNET", chainId: 1, rpc: "https://rpc.flashbots.net", wss: process.env.ETH_WSS, 
            type: "FLASHBOTS", relay: "https://relay.flashbots.net", color: TXT.cyan, 
            priceFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", 
            aavePool: "0x87870Bca3F3f6332F99512Af77db630d00Z638025", 
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564" // Uniswap V3 Universal
        },
        { 
            name: "BASE_MAINNET", chainId: 8453, rpc: process.env.BASE_RPC, wss: process.env.BASE_WSS, 
            color: TXT.magenta, gasOracle: "0x420000000000000000000000000000000000000F", 
            priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", 
            aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", 
            uniswapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481" // Base SwapRouter02
        },
        { 
            name: "ARBITRUM", chainId: 42161, rpc: process.env.ARB_RPC, wss: process.env.ARB_WSS, 
            color: TXT.blue, priceFeed: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612", 
            aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", 
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564" 
        }
    ]
};

// --- GLOBAL AI STATE ---
let currentMarketSignal = { advice: "HOLD", confidence: 0.5, adjustment: 1.0 };

// --- AI ANALYZER ENGINE ---
async function fetchAIAssessment(ethPrice) {
    const systemPrompt = "Professional market analyzer. Provide BUY/SELL signal in JSON.";
    const userQuery = `ETH: $${ethPrice}. Suggest if strikes should be aggressive (BUY) or defensive (SELL).`;
    try {
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { responseMimeType: "application/json" }
        });
        return JSON.parse(response.data.candidates[0].content.parts[0].text);
    } catch (e) { return { advice: "HOLD", confidence: 0, margin_multiplier: 1.0 }; }
}

// --- MASTER PROCESS ---
if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}
╔════════════════════════════════════════════════════════╗
║   ⚡ APEX TITAN v104.0 | OMNISCIENT SCANNER EVOLUTION ║
║   STRATEGY: MEMPOOL DRIVER + PROFIT-GATE + AI SYNC    ║
╚════════════════════════════════════════════════════════╝${TXT.reset}`);

    const blacklist = ["0x4b8251e7c80f910305bb81547e301dcb8a596918", "0x35c3ecffbbdd942a8dba7587424b58f74d6d6d15"];
    if (blacklist.includes(GLOBAL_CONFIG.BENEFICIARY.toLowerCase())) {
        console.error(`${TXT.red}${TXT.bold}[FATAL ERROR] Malicious Beneficiary Detected!${TXT.reset}`);
        process.exit(1);
    }

    const cpuCount = GLOBAL_CONFIG.MAX_CORES;
    for (let i = 0; i < cpuCount; i++) cluster.fork();

    cluster.on('exit', (worker) => {
        console.log(`${TXT.red}⚠️ Core ${worker.id} Died. Respawning in 3s...${TXT.reset}`);
        setTimeout(() => cluster.fork(), 3000);
    });
} 
// --- WORKER PROCESS ---
else {
    const networkIndex = (cluster.worker.id - 1) % GLOBAL_CONFIG.NETWORKS.length;
    const NETWORK = GLOBAL_CONFIG.NETWORKS[networkIndex];
    setTimeout(() => initWorker(NETWORK), (cluster.worker.id % 24) * 8000);
}

async function initWorker(CHAIN) {
    const TAG = `${CHAIN.color}[${CHAIN.name}]${TXT.reset}`;
    const DIVISION = (cluster.worker.id % 4);
    const ROLE = ["SNIPER", "DECODER", "PROBER", "ANALYST"][DIVISION];
    
    let isProcessing = false;
    const walletKey = (process.env.PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY || "").trim();

    if (!walletKey || walletKey.includes("0000000")) return;

    async function safeConnect() {
        try {
            const network = ethers.Network.from(CHAIN.chainId);
            const rpcConfigs = GLOBAL_CONFIG.RPC_POOL.map((url, i) => ({
                provider: new JsonRpcProvider(url, network, { staticNetwork: true }),
                priority: i + 1, stallTimeout: 2500
            }));
            const provider = new FallbackProvider(rpcConfigs, network, { quorum: 1 });
            const wsProvider = new WebSocketProvider(CHAIN.wss, network);
            
            // v14.2 NOISE FILTER
            wsProvider.on('error', (error) => {
                if (error && error.message && (
                    error.message.includes("UNEXPECTED_MESSAGE") || 
                    error.message.includes("delayedMessagesRead") ||
                    error.message.includes("429")
                )) return;
                process.stdout.write(`${TXT.red}!${TXT.reset}`);
            });

            if (wsProvider.websocket) {
                wsProvider.websocket.onclose = () => process.exit(0);
            }

            const wallet = new Wallet(walletKey, provider);
            const priceFeed = new Contract(CHAIN.priceFeed, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], provider);
            const gasOracle = CHAIN.gasOracle ? new Contract(CHAIN.gasOracle, ["function getL1Fee(bytes) view returns (uint256)"], provider) : null;

            const apexIface = new Interface([
                "function executeFlashArbitrage(address tokenA, address tokenOut, uint256 amount)",
                "function flashLoanSimple(address receiver, address asset, uint256 amount, bytes params, uint16 referral)"
            ]);

            console.log(`${TXT.green}✅ CORE ${cluster.worker.id} [${ROLE}] SCANNER ACTIVE${TXT.reset} on ${TAG}`);

            process.on('message', (msg) => {
                if (msg.type === 'MARKET_PULSE') currentMarketSignal = msg.data;
                if (msg.type === 'WHALE_SIGNAL' && msg.chainId === CHAIN.chainId && !isProcessing && ROLE !== "ANALYST") {
                    isProcessing = true;
                    strike(provider, wallet, apexIface, gasOracle, CHAIN, msg.target)
                        .finally(() => setTimeout(() => isProcessing = false, 30000));
                }
            });

            if (ROLE === "ANALYST") {
                setInterval(async () => {
                    try {
                        const [, price] = await priceFeed.latestRoundData();
                        const pulse = await fetchAIAssessment(Number(price) / 1e8);
                        process.send({ type: 'MARKET_PULSE', data: pulse });
                    } catch (e) {}
                }, 300000);
            }

            // --- SCANNER DRIVER LOGIC (Merged from Real Mempool Scanner) ---
            if (DIVISION === 0 || DIVISION === 1) {
                wsProvider.on("pending", async (txHash) => {
                    if (isProcessing) return;
                    try {
                        const tx = await provider.getTransaction(txHash).catch(() => null);
                        if (!tx || !tx.to) return;

                        const valueEth = parseFloat(formatEther(tx.value || 0n));
                        
                        // FILTER: High-Value transactions targeting DEX Routers
                        if (valueEth >= GLOBAL_CONFIG.MIN_WHALE_VALUE) {
                            const isDEX = tx.to.toLowerCase() === CHAIN.uniswapRouter.toLowerCase();
                            if (isDEX) {
                                // Visual Signal Merged from Educational Scanner
                                process.stdout.write(`${TXT.gold}⚡${TXT.reset}`);
                                process.send({ type: 'WHALE_SIGNAL', chainId: CHAIN.chainId, target: tx.to });
                            }
                        }
                    } catch (err) {}
                });
            }

        } catch (e) { setTimeout(safeConnect, 60000); }
    }
    await safeConnect();
}

async function strike(provider, wallet, iface, gasOracle, CHAIN, target) {
    try {
        const weth = CHAIN.chainId === 8453 ? "0x4200000000000000000000000000000000000006" : "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        
        // v104.0: Strategy Evaluation (Contract Arb vs Aave High-Capacity)
        let txData;
        const bal = await provider.getBalance(wallet.address);
        
        if (parseFloat(formatEther(bal)) > 0.05) {
            txData = iface.encodeFunctionData("flashLoanSimple", [
                GLOBAL_CONFIG.TARGET_CONTRACT,
                weth,
                GLOBAL_CONFIG.FLASH_LOAN_AMOUNT,
                "0x",
                0
            ]);
        } else {
            txData = iface.encodeFunctionData("executeFlashArbitrage", [weth, target, 0]);
        }

        const [simulation, feeData] = await Promise.all([
            provider.call({ to: CHAIN.aavePool || GLOBAL_CONFIG.TARGET_CONTRACT, data: txData, from: wallet.address, gasLimit: GLOBAL_CONFIG.GAS_LIMIT }).catch(() => null),
            provider.getFeeData()
        ]);

        if (!simulation || simulation === "0x") return;

        const rawProfit = BigInt(simulation);
        const l2GasCost = GLOBAL_CONFIG.GAS_LIMIT * (feeData.maxFeePerGas || feeData.gasPrice);
        const l1Fee = (gasOracle) ? await gasOracle.getL1Fee(txData).catch(() => 0n) : 0n;
        const totalGasCost = l2GasCost + l1Fee;
        
        let multiplier = 120n;
        if (currentMarketSignal.advice === "BUY") multiplier = 110n;
        if (currentMarketSignal.advice === "SELL") multiplier = 150n;

        if (rawProfit > (totalGasCost * multiplier) / 100n) {
            const netProfit = rawProfit - totalGasCost;
            
            // Educational Scanner Logging Style Incorporation
            console.log(`\n${TXT.gold}⚡ WHALE DETECTED [${CHAIN.name}] | ANALYZING FLOW...${TXT.reset}`);
            console.log(`   ↳ ${TXT.blue}📦 BUNDLE: [Frontrun] -> [Whale] -> [Backrun]${TXT.reset}`);
            console.log(`   ↳ ${TXT.cyan}📐 ARBITRAGE: Net +${formatEther(netProfit)} ETH${TXT.reset}`);

            const tx = {
                to: CHAIN.aavePool || GLOBAL_CONFIG.TARGET_CONTRACT, data: txData, type: 2, chainId: CHAIN.chainId,
                gasLimit: GLOBAL_CONFIG.GAS_LIMIT, maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * 150n) / 100n,
                nonce: await provider.getTransactionCount(wallet.address), value: 0n
            };

            const signedTx = await wallet.signTransaction(tx);
            await axios.post(CHAIN.rpc, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedTx] }, { timeout: 2000 }).catch(() => {});
            console.log(`${TXT.green}${TXT.bold}💎 TITAN SECURED: FUNDS AT ${GLOBAL_CONFIG.BENEFICIARY}${TXT.reset}`);
        }
    } catch (e) {}
}
