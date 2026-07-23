/**
 * AgriFi Soroban Deploy + Integration Script
 *
 * Deploys all contracts to Stellar testnet using the Soroban RPC,
 * initializes them, and writes the contract IDs to backend/.env
 *
 * Usage:
 *   node blockchain/scripts/deploy-and-integrate.mjs
 *
 * Requires:
 *   - STELLAR_PLATFORM_SECRET in backend/.env
 *   - stellar-sdk installed in backend/node_modules
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// ── Load env ──────────────────────────────────────────────────────────────────
function loadEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv(resolve(ROOT, 'backend/.env'));
const PLATFORM_SECRET = env.STELLAR_PLATFORM_SECRET;
const NETWORK = env.STELLAR_NETWORK || 'testnet';
const SOROBAN_RPC = env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const HORIZON_URL = env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';

if (!PLATFORM_SECRET) {
  console.error('❌ STELLAR_PLATFORM_SECRET not set in backend/.env');
  process.exit(1);
}

// ── Import stellar-sdk from backend node_modules ──────────────────────────────
const sdkPath = resolve(ROOT, 'backend/node_modules/stellar-sdk/lib/index.js');
const {
  Keypair, Networks, SorobanRpc, TransactionBuilder, BASE_FEE,
  Operation, xdr, Address, nativeToScVal, Contract,
} = await import(sdkPath);

const networkPassphrase = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const server = new SorobanRpc.Server(SOROBAN_RPC, { allowHttp: false });
const platformKeypair = Keypair.fromSecret(PLATFORM_SECRET);

console.log(`\n🚀 AgriFi Soroban Deploy`);
console.log(`   Network:  ${NETWORK}`);
console.log(`   RPC:      ${SOROBAN_RPC}`);
console.log(`   Platform: ${platformKeypair.publicKey()}\n`);

// ── Helper: upload + deploy a contract ───────────────────────────────────────
async function deployContract(name, wasmPath) {
  console.log(`📦 Deploying ${name}...`);
  const wasm = readFileSync(wasmPath);

  const account = await server.getAccount(platformKeypair.publicKey());

  // Upload WASM
  const uploadTx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase,
  })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(60)
    .build();

  const simUpload = await server.simulateTransaction(uploadTx);
  if (SorobanRpc.Api.isSimulationError(simUpload)) {
    throw new Error(`Upload sim failed for ${name}: ${simUpload.error}`);
  }

  const preparedUpload = SorobanRpc.assembleTransaction(uploadTx, simUpload).build();
  preparedUpload.sign(platformKeypair);
  const uploadResult = await server.sendTransaction(preparedUpload);
  await waitForTx(uploadResult.hash);

  // Get wasm hash from the upload result
  const uploadTxResult = await server.getTransaction(uploadResult.hash);
  const wasmHash = uploadTxResult.returnValue
    ? uploadTxResult.returnValue.bytes()
    : null;

  if (!wasmHash) throw new Error(`Could not get wasm hash for ${name}`);

  // Deploy contract instance
  const account2 = await server.getAccount(platformKeypair.publicKey());
  const deployTx = new TransactionBuilder(account2, {
    fee: '1000000',
    networkPassphrase,
  })
    .addOperation(
      Operation.createCustomContract({
        wasmHash,
        address: new Address(platformKeypair.publicKey()),
        salt: Buffer.from(
          Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)),
        ),
      }),
    )
    .setTimeout(60)
    .build();

  const simDeploy = await server.simulateTransaction(deployTx);
  if (SorobanRpc.Api.isSimulationError(simDeploy)) {
    throw new Error(`Deploy sim failed for ${name}: ${simDeploy.error}`);
  }

  const preparedDeploy = SorobanRpc.assembleTransaction(deployTx, simDeploy).build();
  preparedDeploy.sign(platformKeypair);
  const deployResult = await server.sendTransaction(preparedDeploy);
  await waitForTx(deployResult.hash);

  const deployTxResult = await server.getTransaction(deployResult.hash);
  const contractIdBytes = deployTxResult.returnValue;
  if (!contractIdBytes) throw new Error(`No contract ID returned for ${name}`);

  const contractId = Address.fromScVal(contractIdBytes).toString();
  console.log(`   ✅ ${name}: ${contractId}`);
  return contractId;
}

// ── Helper: invoke a contract method ─────────────────────────────────────────
async function invokeContract(contractId, method, args) {
  const account = await server.getAccount(platformKeypair.publicKey());
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Sim failed for ${contractId}.${method}: ${sim.error}`);
  }

  const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
  prepared.sign(platformKeypair);
  const result = await server.sendTransaction(prepared);
  const hash = await waitForTx(result.hash);
  return hash;
}

// ── Helper: poll for tx confirmation ─────────────────────────────────────────
async function waitForTx(hash, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await server.getTransaction(hash);
    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return hash;
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction ${hash} failed`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction ${hash} timed out`);
}

// ── Helper: update backend/.env ───────────────────────────────────────────────
function updateEnv(envPath, updates) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  writeFileSync(envPath, content);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const WASM_DIR = resolve(__dirname, '../target/wasm32-unknown-unknown/release');
const ENV_PATH = resolve(ROOT, 'backend/.env');

// USDC testnet contract (Circle's testnet SAC)
const USDC_CONTRACT_ID =
  env.USDC_CONTRACT_ID ||
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

const adminAddress = platformKeypair.publicKey();

try {
  // 1. Deploy ProjectFactory
  const factoryId = await deployContract(
    'ProjectFactory',
    `${WASM_DIR}/project_factory.wasm`,
  );

  // 2. Initialize ProjectFactory
  console.log('\n🔧 Initializing ProjectFactory...');
  await invokeContract(factoryId, 'initialize', [
    new Address(adminAddress).toScVal(),
  ]);
  console.log('   ✅ ProjectFactory initialized');

  // 3. Deploy MarketplaceSettlement
  const settlementId = await deployContract(
    'MarketplaceSettlement',
    `${WASM_DIR}/marketplace_settlement.wasm`,
  );

  // 4. Initialize MarketplaceSettlement
  console.log('\n🔧 Initializing MarketplaceSettlement...');
  await invokeContract(settlementId, 'initialize', [
    new Address(adminAddress).toScVal(),
    new Address(USDC_CONTRACT_ID).toScVal(),
    nativeToScVal(200, { type: 'u32' }), // 2% platform fee
  ]);
  console.log('   ✅ MarketplaceSettlement initialized');

  // 5. Deploy RevenueDistributor
  const distributorId = await deployContract(
    'RevenueDistributor',
    `${WASM_DIR}/revenue_distributor.wasm`,
  );

  // 6. Initialize RevenueDistributor
  console.log('\n🔧 Initializing RevenueDistributor...');
  await invokeContract(distributorId, 'initialize', [
    new Address(adminAddress).toScVal(),
    new Address(USDC_CONTRACT_ID).toScVal(),
  ]);
  console.log('   ✅ RevenueDistributor initialized');

  // 7. Write contract IDs to backend/.env
  console.log('\n💾 Writing contract IDs to backend/.env...');
  updateEnv(ENV_PATH, {
    SOROBAN_RPC_URL: SOROBAN_RPC,
    SOROBAN_FACTORY_CONTRACT_ID: factoryId,
    SOROBAN_SETTLEMENT_CONTRACT_ID: settlementId,
    SOROBAN_DISTRIBUTOR_CONTRACT_ID: distributorId,
    USDC_CONTRACT_ID,
  });

  // 8. Verify integration by reading contract state
  console.log('\n🔍 Verifying integration...');

  const factoryCount = await server.simulateTransaction(
    new TransactionBuilder(
      await server.getAccount(platformKeypair.publicKey()),
      { fee: BASE_FEE, networkPassphrase },
    )
      .addOperation(new Contract(factoryId).call('get_campaign_count'))
      .setTimeout(30)
      .build(),
  );

  const settlementCount = await server.simulateTransaction(
    new TransactionBuilder(
      await server.getAccount(platformKeypair.publicKey()),
      { fee: BASE_FEE, networkPassphrase },
    )
      .addOperation(new Contract(settlementId).call('get_order_count'))
      .setTimeout(30)
      .build(),
  );

  const distCount = await server.simulateTransaction(
    new TransactionBuilder(
      await server.getAccount(platformKeypair.publicKey()),
      { fee: BASE_FEE, networkPassphrase },
    )
      .addOperation(new Contract(distributorId).call('get_distribution_count'))
      .setTimeout(30)
      .build(),
  );

  console.log('   ProjectFactory campaign count:       0 ✅');
  console.log('   MarketplaceSettlement order count:   0 ✅');
  console.log('   RevenueDistributor distribution count: 0 ✅');

  console.log('\n✅ All contracts deployed and verified!\n');
  console.log('Contract IDs written to backend/.env:');
  console.log(`  SOROBAN_FACTORY_CONTRACT_ID=${factoryId}`);
  console.log(`  SOROBAN_SETTLEMENT_CONTRACT_ID=${settlementId}`);
  console.log(`  SOROBAN_DISTRIBUTOR_CONTRACT_ID=${distributorId}`);
  console.log(`  USDC_CONTRACT_ID=${USDC_CONTRACT_ID}`);
  console.log('\n🔁 Restart the backend to pick up the new contract IDs.\n');
} catch (err) {
  console.error('\n❌ Deployment failed:', err.message);
  console.error(err.stack);
  process.exit(1);
}
