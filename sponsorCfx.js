// load config
const {Conflux} = require('js-conflux-sdk');
const BigNumber = require('bignumber.js');
const fs = require('fs');
const cfx = new Conflux({url: "http://main.confluxrpc.org"});
//const cfx = new Conflux({url: "http://test.confluxrpc.org"});

const price = 1;
// sponsor private key
let priv_key = "";
// contract address to sponsor
let contract_addr = '';
// 100 cfx
let gas_amount = 100;
// 100 cfx
let collateral_amount = 100;
// 0.00001 cfx
let gas_per_tx = 0.00001;

if (!(priv_key.startsWith('0x')))
  priv_key = `0x${priv_key}`;
let owner = cfx.Account(priv_key);

gas_amount = (new BigNumber(1e18)).multipliedBy(gas_amount).toString(10);
collateral_amount = (new BigNumber(1e18)).multipliedBy(collateral_amount).toString(10);
gas_per_tx = (new BigNumber(1e18)).multipliedBy(gas_per_tx).toString(10);


const cfx_sponsor_contract = JSON.parse(fs.readFileSync(__dirname + '/SponsorWhitelistControl.json'));
const cfx_sponsor = cfx.Contract({
  abi: cfx_sponsor_contract.abi,
  address: '0x0888000000000000000000000000000000000001',
});

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

async function waitForReceipt(hash) {
  for (;;) {
    let res = await cfx.getTransactionReceipt(hash);
    if (res != null) {
      if (
        res.stateRoot !==
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ) {
        return res;
      }
    }
    await sleep(30000);
  }
}

async function waitAndVerify(hash, task) {
  let receipt = await waitForReceipt(hash);
  if (receipt.outcomeStatus !== 0) {
    console.log(`${task} failed!`);
    process.exit(1);
  }
  return receipt;
}

async function waitNonce(target, acc) {
  let x;
  for (;;) {
    x = Number(await cfx.getNextNonce(acc));
    if (x < target) {
      await sleep(5000);
      continue;
    }
    break;
  }
  return x;
}


async function sendTransaction(tx_params) {
  let i = 0;
  let retry_round = 10;
  for (;;) {
    let j = 0;
    for (;;) {
      try {
        let res = await cfx.estimateGasAndCollateral(tx_params);
        let estimate_gas = Number(res.gasUsed);
        let estimate_storage = Number(res.storageCollateralized);
        tx_params.gas = Math.ceil(estimate_gas * 1.3);
        tx_params.storageLimit = "10000";
        tx_params.gasPrice = new BigNumber(await cfx.getGasPrice())
          .multipliedBy(1.05)
          .integerValue()
          .toString(10);
        tx_params.gasPrice = '1';
        break;
      } catch (e) {
        ++j;
        if (j % retry_round === 0) {
          console.log(`estimate retried ${j} times. received error: ${e}`);
        }
        await sleep(500);
      }
    }

    try {
      let tx_hash = await cfx.sendTransaction(tx_params);
      return tx_hash;
    } catch (e) {
      ++i;
      if (i % retry_round === 0) {
        console.log(`send retried ${i} times. received error: ${e}`);
      }
      await sleep(500);
    }
  }
}

async function sponsorCfx(addr, msg, nonce, gas_amount, collateral_amount) {
  let p = [];
  console.log(`sponsor gas for ${msg}..`);
  let tx_hash = await sendTransaction({
    from: owner,
    to: cfx_sponsor.address,
    gas: 10000000,
    nonce: nonce,
    gasPrice: price,
    value: gas_amount,
    data: cfx_sponsor.setSponsorForGas(addr, gas_per_tx)
      .data,
  });
  nonce += 1;
  p.push(waitAndVerify(tx_hash, `sponsor gas for ${msg}`));
  console.log(`sponsor collateral for ${msg}..`);
  tx_hash = await sendTransaction({
    from: owner,
    to: cfx_sponsor.address,
    gas: 10000000,
    nonce: nonce,
    gasPrice: price,
    value: collateral_amount,
    data: cfx_sponsor.setSponsorForCollateral(addr).data,
  });
  p.push(waitAndVerify(tx_hash, `sponsor collateral for ${msg}`));
  nonce += 1;
  await Promise.all(p);
}

async function run() {
  let nonce = Number(await cfx.getNextNonce(owner.address));
  await sponsorCfx(contract_addr, contract_addr, nonce, gas_amount, collateral_amount);
  await waitNonce(nonce, owner.address);
}

// conflux
run();
