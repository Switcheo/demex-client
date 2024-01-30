<div align="center">
  <img height="120x" src="https://raw.githubusercontent.com/Switcheo/token-icons/main/demex/demex_color.png" />

  <h1 style="margin-top:20px;">Demex Client</h1>

  <p>
    <a href="https://discord.com/channels/738816874720133172/763588653116555294"><img alt="Discord Chat" src="https://img.shields.io/discord/738816874720133172?color=3e35ff" /></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-3e35ff" /></a>
  </p>
</div>

# Demex Client

This is an opinionated typescript client that wraps around [carbon-js-sdk](https://github.com/Switcheo/carbon-js-sdk) to proivde a simple way to programmatically trade on Carbon's Perpetuals markets.

Some data are steamed over websockets and cached in memory while the remaining are fetched asynchronously over gRPC or API methods.

## Constraints

- MAINNET support only
- Perpetuals trading only

## Installation

```
# For NPM
npm install demex-client --legacy-peer-deps

# For Yarn
yarn add demex-client --legacy-peer-deps
```

## Warning

This client is considered Alpha software and is under develpoment at the moment. Client may contain bugs and hence use at your own risk.

## Features

- [ ] Uses human friendly symbols instead of market ids (e.g. "ETH" -> "cmkt/117")
- [ ] Astracts all sats values & requirements to human readable values
- [ ] Dead man's switch for chain and indexer liveliness to prevent stale data
- [ ] Virtualization of user account state via websockets
- [ ] Virtualization of market data state via websockets
- [ ] Wraps position data with mark price and unrealized profit & loss
- [ ] Warps market stats with funding rates

## Roadmap

- [ ] Expose websocket messages
- [ ] Wrapped deposit and withdrawal transfer functions
- [ ] Devnet & Testnet support

## Quickstart

```

import { Client, OrderSide, OrderType, MAINNET_TOKENS } from 'demex-client'

async function run() {

  const bot = new Client()
  await bot.init({ mnemonic: "YOUR MNEMONIC"})
  bot.subscribeOrderBooks(['BTC', 'ETH'])
  bot.subscribeAccountData()

  await bot.startWebsocket()

  // MARKET DATA

  const orderBook = bot.getOrderBook('ETH')
  const recentTrades = await bot.getTrades('BTC')
  const stats = await bot.getMarketStats()

  // ACCOUNT DATA

  const usdBalance = bot.getBalance(MAINNET_TOKENS.USD)
  const positions = bot.getPositions()
  const position = bot.getPosition('BTC')
  const orders = bot.getOpenOrders('BTC')

  const userTrades = await bot.getUserTrades('BTC')
  const leverages = await bot.getMarketsLeverage()

  // TRANSACTIONS

  const order = await bot.submitOrder({
    symbol: 'BTC',
    side: OrderSide.Buy,
    price: 40000.001,
    quantity: 0.0011111,
    type: OrderType.Limit,
  })
  const cancels = await bot.cancelAll('BTC')
  cosnt cancel = await.bot.cancelOrder("ORDERID")
  const leverage = await bot.updateLeverage('ETH', 1.3)

}

```

## Bugs / Requests

Submit an issue [here](https://github.com/Switcheo/demex-client/issues).
